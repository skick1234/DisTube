import {
  type Adapter,
  DisTube,
  Events,
  type PlaybackContext,
  type PlaybackPreparation,
  type Player,
  type PluginContext,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
} from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErisAdapter } from "../src";
import { ErisVoiceEngine } from "../src/engine";
import {
  asClient,
  CHANNEL,
  FakeClient,
  finishCurrent,
  GUILD,
  latest,
  resetNative,
  settle,
  voiceChannel,
} from "./support/eris";

vi.mock("node:child_process", async () => (await import("./support/eris")).childProcessModule());

const OTHER_CHANNEL = "other";

beforeEach(resetNative);

describe("Eris adapter queue lifecycle", () => {
  it("moves one guild queue through the adapter's live session without ending its active item", async () => {
    const client = new FakeClient();
    client.channels.set(OTHER_CHANNEL, voiceChannel());
    const distube = createDisTube(client);
    const finished = vi.fn();
    const failed = vi.fn();
    distube.on(Events.QueueItemFinished, finished);
    distube.on(Events.QueueItemFailed, failed);

    const started = waitForStart(distube);
    const first = await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await started;
    const activeId = first.queue.state.current?.id;

    const second = await distube.play({ guildId: GUILD, voiceChannelId: OTHER_CHANNEL }, song("B"));

    expect(second.queue).toBe(first.queue);
    expect(distube.queues.size).toBe(1);
    expect(client.joinVoiceChannel).toHaveBeenCalledTimes(2);
    expect(client.connection.channelID).toBe(OTHER_CHANNEL);
    expect(first.queue.state.current?.id).toBe(activeId);
    expect(finished).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("restores a rejected native move before a later play targets the committed channel", async () => {
    const client = new FakeClient();
    client.channels.set(OTHER_CHANNEL, voiceChannel());
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await started;
    const failure = new Error("move failed");
    client.join = async channelId => {
      client.connection.channelID = channelId;
      if (channelId === OTHER_CHANNEL) throw failure;
      return client.connection;
    };

    await expect(distube.play({ guildId: GUILD, voiceChannelId: OTHER_CHANNEL }, song("B"))).rejects.toMatchObject({
      code: "VOICE_FAILED",
      cause: failure,
    });

    expect(distube.voices.get(GUILD)?.channelId).toBe(CHANNEL);
    expect(client.connection.channelID).toBe(CHANNEL);
    const later = await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("C"));

    expect(later.queue.state.current?.song.id).toBe("A");
    expect(client.joinVoiceChannel).toHaveBeenCalledTimes(3);
  });

  it("waits for the owned decoder to close before session release on voice leave", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const outcomes = vi.fn();
    distube.on(Events.QueueItemFinished, outcomes);
    distube.on(Events.QueueItemFailed, outcomes);
    await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await started;
    const child = latest.child;

    const leaving = distube.voices.leave(GUILD);
    await settle();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(client.leaveVoiceChannel).not.toHaveBeenCalled();
    child.close(null, "SIGKILL");
    await leaving;

    expect(client.leaveVoiceChannel).toHaveBeenCalledWith(CHANNEL);
    expect(distube.getQueue(GUILD)).toBeUndefined();
    finishCurrent(client.connection);
    await settle();
    expect(outcomes).not.toHaveBeenCalled();
  });

  it("publishes one failed queue item for a post-start decoder exit and never finishes it", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const failed = waitForFailure(distube);
    const finished = vi.fn();
    distube.on(Events.QueueItemFinished, finished);
    await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await started;

    latest.child.close(1, null);
    await failed;
    await settle();

    expect(finished).not.toHaveBeenCalled();
  });

  it("deletes the queue once for a terminal Eris disconnect", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const disconnected = vi.fn();
    distube.on(Events.VoiceDisconnected, disconnected);
    await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await started;
    const child = latest.child;

    client.connection.emit("disconnect", new Error("connection lost"));
    child.close(null, "SIGKILL");
    await settle();

    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(distube.getQueue(GUILD)).toBeUndefined();
  });

  it("accepts one terminal disconnect across session and Player paths", async () => {
    const client = new FakeClient();
    const harness = createHarness(client);
    const order: string[] = [];
    const started: string[] = [];
    let failedItem = "";
    const failed = new Promise<void>(resolve => {
      harness.distube.on(Events.QueueItemFailed, event => {
        order.push("failed");
        failedItem = event.item.song.id;
        resolve();
      });
    });
    const deleted = new Promise<void>(resolve => {
      harness.distube.on(Events.QueueDeleted, () => {
        order.push("deleted");
        resolve();
      });
    });
    const disconnected = new Promise<void>(resolve => {
      harness.distube.on(Events.VoiceDisconnected, () => {
        order.push("disconnected");
        resolve();
      });
    });
    harness.distube.on(Events.QueueItemStarted, event => started.push(event.item.song.id));

    const firstStarted = waitForStart(harness.distube);
    await harness.distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("A"));
    await firstStarted;
    await harness.distube.play({ guildId: GUILD, voiceChannelId: CHANNEL }, song("B"));
    const child = latest.child;

    client.connection.emit("disconnect", new Error("connection lost"));
    child.close(null, "SIGKILL");
    await Promise.all([failed, deleted, disconnected]);

    expect(failedItem).toBe("A");
    expect(order).toEqual(["failed", "deleted", "disconnected"]);
    expect(started).toEqual(["A"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await expect(
      harness.player().play({
        itemId: "later",
        resource: { kind: "url", url: "https://stream.example/later", dispose: () => undefined },
      }),
    ).rejects.toThrow("retired");
  });
});

function createDisTube(client: FakeClient): DisTube {
  return createHarness(client).distube;
}

function createHarness(client: FakeClient): { readonly distube: DisTube; readonly player: () => Player } {
  const adapter = new ErisAdapter(asClient(client));
  const engine = new ErisVoiceEngine(undefined, async () => undefined);
  let player: Player | undefined;
  const bridge: Adapter = {
    createVoiceSession: target => adapter.createVoiceSession(target),
    engine: {
      accepts: engine.accepts,
      createPlayer: async session => {
        player = await engine.createPlayer(session);
        return player;
      },
      resolvable: name => engine.resolvable(name),
    },
  };
  return {
    distube: new DisTube({ adapter: bridge, plugins: [localSource()] }),
    player: () => {
      if (!player) throw new Error("Expected playback to create an Eris Player");
      return player;
    },
  };
}

function localSource(): SourcePlugin {
  return {
    name: "local",
    initialize: (_context: PluginContext): void => undefined,
    dispose: (): void => undefined,
    search: async (_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> => [],
    resolve: async (_url: string, _options?: SourceOperationOptions): Promise<undefined> => undefined,
    preparePlayback: async (value: Song, _context: PlaybackContext): Promise<PlaybackPreparation> => ({
      kind: "resource",
      resource: {
        kind: "url",
        url: `https://stream.example/${value.id}`,
        dispose: (): void => undefined,
      },
    }),
  };
}

function song(id: string): Song {
  return new Song({
    id,
    title: id,
    url: `https://provider.example/${id}`,
    duration: 60,
    source: "local",
  });
}

function waitForStart(distube: DisTube): Promise<void> {
  return new Promise(resolve => distube.once(Events.QueueItemStarted, () => resolve()));
}

function waitForFailure(distube: DisTube): Promise<void> {
  return new Promise(resolve => distube.once(Events.QueueItemFailed, () => resolve()));
}
