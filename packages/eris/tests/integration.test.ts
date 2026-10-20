import { DisTube, Song } from "distube";
import type {
  PlaybackContext,
  PlaybackPreparation,
  Player,
  PluginContext,
  SourceOperationOptions,
  SourcePlugin,
} from "distube/integrations";
import type * as ErisModule from "eris";
import type { VoiceChannel } from "eris";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Transport extends FakeVoiceConnection {
  readonly credentials: unknown[];
  readonly disconnects: number;
}

const { preflight, preflightFactory, transports } = vi.hoisted(() => {
  const check = vi.fn(async (): Promise<void> => undefined);
  const factory = vi.fn((_owner: string) => check);
  return { preflight: check, preflightFactory: factory, transports: [] as Transport[] };
});

import { ErisAdapter } from "../src";
import type * as ErisEngine from "../src/engine";
import {
  announceState,
  asClient,
  CHANNEL,
  FakeClient,
  type FakeVoiceConnection,
  finishCurrent,
  GATEWAY,
  GUILD,
  latest,
  resetNative,
  settle,
  voiceChannel,
} from "./support/eris";

vi.mock("node:child_process", async () => (await import("./support/eris")).childProcessModule());
vi.mock("../src/engine", async importOriginal => {
  const actual = await importOriginal<typeof ErisEngine>();
  return { ...actual, erisPreflight: preflightFactory };
});
/** The local audio socket the session attaches: ready once given credentials, cleared by disconnect. */
vi.mock("eris", async () => {
  const actual = await vi.importActual<typeof ErisModule>("eris");
  const { FakeVoiceConnection } = await import("./support/eris");
  class VoiceConnection extends FakeVoiceConnection implements Transport {
    readonly credentials: unknown[] = [];
    disconnects = 0;
    constructor() {
      super();
      this.channelID = null;
      this.ready = false;
      transports.push(this);
    }
    connect(data: { channel_id: string }): void {
      this.credentials.push(data);
      this.channelID = data.channel_id;
      queueMicrotask(() => {
        this.ready = true;
        this.emit("ready");
      });
    }
    disconnect(): void {
      this.disconnects++;
      this.ready = false;
      this.channelID = null;
      this.emit("disconnect");
    }
  }
  return { ...actual, VoiceConnection };
});

const OTHER_CHANNEL = "other";
/** What the session hands each attached transport, from the fake gateway's credentials. */
const CREDENTIALS = {
  channel_id: CHANNEL,
  session_id: GATEWAY.sessionId,
  endpoint: GATEWAY.endpoint,
  token: GATEWAY.token,
  user_id: "bot",
};

beforeEach(() => {
  resetNative();
  transports.length = 0;
  preflight.mockReset();
  preflight.mockResolvedValue(undefined);
  preflightFactory.mockClear();
});

describe("Eris adapter queue lifecycle", () => {
  it("joins remotely without local prerequisites and checks them when playback starts", async () => {
    const client = new FakeClient();
    preflight.mockRejectedValueOnce(new Error("@distube/eris requires tweetnacl"));
    const distube = new DisTube({ adapter: new ErisAdapter(asClient(client)), sources: [] });

    const voice = await distube.voices.join(target(CHANNEL));
    expect(client.sendWS).toHaveBeenCalled();
    expect(preflight).not.toHaveBeenCalled();
    expect(preflightFactory).toHaveBeenCalledWith("@distube/eris");
    await expect(voice.play({ kind: "file", path: "/tmp/distube-eris-preflight.mp3" })).rejects.toMatchObject({
      code: "VOICE_FAILED",
    });
    expect(client.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("moves one guild queue through the adapter's live session without ending its active item", async () => {
    const client = new FakeClient();
    client.channels.set(OTHER_CHANNEL, voiceChannel());
    const distube = createDisTube(client);
    const finished = vi.fn();
    const failed = vi.fn();
    distube.on("queue.item.finished", finished);
    distube.on("queue.item.failed", failed);

    const started = waitForStart(distube);
    const first = await distube.play(target(CHANNEL), song("A"));
    await started;
    const activeId = first.current?.id;

    const second = await distube.play(target(OTHER_CHANNEL), song("B"));

    expect(second).toBe(first);
    expect(distube.queues.size).toBe(1);
    expect(client.sendWS).toHaveBeenLastCalledWith(4, expect.objectContaining({ channel_id: OTHER_CHANNEL }));
    expect(first.voice?.channelId).toBe(OTHER_CHANNEL);
    expect(first.current?.id).toBe(activeId);
    expect(finished).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("restores a rejected native move before a later play targets the committed channel", async () => {
    const client = new FakeClient();
    client.channels.set(OTHER_CHANNEL, voiceChannel());
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    await distube.play(target(CHANNEL), song("A"));
    await started;
    const failure = new Error("move failed");
    client.sendWS.mockImplementationOnce(() => {
      throw failure;
    });

    await expect(distube.play(target(OTHER_CHANNEL), song("B"))).rejects.toMatchObject({
      code: "VOICE_FAILED",
      cause: failure,
    });

    expect(distube.voices.get(GUILD)?.channelId).toBe(CHANNEL);
    const later = await distube.play(target(CHANNEL), song("C"));

    expect(later.current?.song.id).toBe("A");
  });

  it("waits for the owned decoder to close before session release on voice leave", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const outcomes = vi.fn();
    distube.on("queue.item.finished", outcomes);
    distube.on("queue.item.failed", outcomes);
    await distube.play(target(CHANNEL), song("A"));
    await started;
    const child = latest.child;

    const leaving = distube.voices.leave(GUILD);
    await settle();

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(leaves(client)).toBe(0);
    child.close(null, "SIGKILL");
    await leaving;

    expect(leaves(client)).toBe(1);
    expect(distube.getQueue(GUILD)).toBeUndefined();
    finishCurrent(transport(0));
    await settle();
    expect(outcomes).not.toHaveBeenCalled();
  });

  it("publishes one failed queue item for a post-start decoder exit and never finishes it", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const failed = waitForFailure(distube);
    const finished = vi.fn();
    distube.on("queue.item.finished", finished);
    await distube.play(target(CHANNEL), song("A"));
    await started;

    latest.child.close(1, null);
    await failed;
    await settle();

    expect(finished).not.toHaveBeenCalled();
  });

  it("retires a failed Player and its transport while keeping the gateway session live", async () => {
    const client = new FakeClient();
    const distube = createDisTube(client);
    const started = waitForStart(distube);
    const disconnected = vi.fn();
    distube.on("voice.disconnected", disconnected);
    await distube.play(target(CHANNEL), song("A"));
    await started;
    const child = latest.child;

    transport(0).emit("disconnect", new Error("connection lost"));
    child.close(null, "SIGKILL");
    await settle();

    expect(disconnected).not.toHaveBeenCalled();
    expect(distube.getQueue(GUILD)).toBeUndefined();
    expect(distube.voices.get(GUILD)?.channelId).toBe(CHANNEL);
    expect(leaves(client)).toBe(0);
    expect(transport(0).disconnects).toBe(1);

    const restarted = waitForStart(distube);
    await distube.play(target(CHANNEL), song("B"));
    await restarted;

    expect(transports).toHaveLength(2);
    expect(transport(1).credentials).toEqual([CREDENTIALS]);
    expect(leaves(client)).toBe(0);
  });

  it("accepts one terminal disconnect across session and Player paths", async () => {
    const client = new FakeClient();
    const harness = createHarness(client);
    const order: string[] = [];
    const started: string[] = [];
    let failedItem = "";
    const failed = new Promise<void>(resolve => {
      harness.distube.on("queue.item.failed", event => {
        order.push("failed");
        failedItem = event.item.song.id;
        resolve();
      });
    });
    const deleted = new Promise<void>(resolve => {
      harness.distube.on("queue.deleted", () => {
        order.push("deleted");
        resolve();
      });
    });
    const disconnected = new Promise<void>(resolve => {
      harness.distube.on("voice.disconnected", () => {
        order.push("disconnected");
        resolve();
      });
    });
    harness.distube.on("queue.item.started", event => started.push(event.item.song.id));

    const firstStarted = waitForStart(harness.distube);
    await harness.distube.play(target(CHANNEL), song("A"));
    await firstStarted;
    await harness.distube.play(target(CHANNEL), song("B"));
    const child = latest.child;

    transport(0).emit("disconnect", new Error("connection lost"));
    announceState(client, undefined, GUILD, null);
    child.close(null, "SIGKILL");
    await Promise.all([failed, deleted, disconnected]);

    expect(failedItem).toBe("A");
    expect(order).toEqual(["failed", "deleted", "disconnected"]);
    expect(started).toEqual(["A"]);
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    await expect(
      (await harness.player()).play({
        itemId: "later",
        resource: { kind: "url", url: "https://stream.example/later", dispose: () => undefined },
      }),
    ).rejects.toThrow("retired");
  });
});

function target(id: string): VoiceChannel {
  return { id, guildID: GUILD, guild: { id: GUILD } } as unknown as VoiceChannel;
}

function createDisTube(client: FakeClient): DisTube<unknown, VoiceChannel> {
  return createHarness(client).distube;
}

/** The real adapter and engine; the spy only exposes the first Player the engine created. */
function createHarness(client: FakeClient): {
  readonly distube: DisTube<unknown, VoiceChannel>;
  readonly player: () => Promise<Player>;
} {
  const adapter = new ErisAdapter(asClient(client));
  const createPlayer = vi.spyOn(adapter.engine, "createPlayer");
  return {
    distube: new DisTube({ adapter, sources: [localSource()] }),
    player: () => {
      const created = createPlayer.mock.results[0];
      if (created?.type !== "return") throw new Error("Expected playback to create an Eris Player");
      return created.value;
    },
  };
}

function transport(index: number): Transport {
  const created = transports[index];
  if (!created) throw new Error(`Expected Eris transport ${index}`);
  return created;
}

/** Gateway leave payloads: only a session release may send one. */
function leaves(client: FakeClient): number {
  return client.sendWS.mock.calls.filter(([, payload]) => payload.channel_id === null).length;
}

function localSource(): SourcePlugin {
  return {
    name: "local",
    initialize: (_context: PluginContext): void => undefined,
    dispose: (): void => undefined,
    search: async (_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> => [],
    resolve: async (_url: string, _options?: SourceOperationOptions): Promise<undefined> => undefined,
    stream: async (value: Song, _context: PlaybackContext): Promise<PlaybackPreparation> => ({
      kind: "resource",
      resource: {
        kind: "file",
        path: `/tmp/distube-eris-${value.id}.mp3`,
        dispose: (): void => undefined,
      },
    }),
  };
}

function song(id: string): Song {
  return new Song({
    id,
    name: id,
    url: `https://provider.example/${id}`,
    duration: 60,
    source: "local",
  });
}

function waitForStart(distube: DisTube<unknown, VoiceChannel>): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsubscribe = distube.on("queue.item.started", () => {
      unsubscribe();
      stopFailure();
      resolve();
    });
    const stopFailure = distube.on("queue.item.failed", event => {
      unsubscribe();
      stopFailure();
      reject(event.error);
    });
  });
}

function waitForFailure(distube: DisTube<unknown, VoiceChannel>): Promise<void> {
  return new Promise(resolve => {
    const unsubscribe = distube.on("queue.item.failed", () => {
      unsubscribe();
      resolve();
    });
  });
}
