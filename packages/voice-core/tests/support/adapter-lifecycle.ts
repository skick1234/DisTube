import {
  type Adapter,
  DisTube,
  Events,
  type PlaybackContext,
  type PlaybackPreparation,
  type PluginContext,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
  type VoiceSession,
  type VoiceTarget,
} from "distube";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../../src/engine";
import { audioPlayerError, type FakeConnection, latest, native, resetNative, settle } from "./native";

const GUILD = "guild";
const CHANNEL_A = "channel-a";
const CHANNEL_B = "channel-b";

export interface AdapterLifecycleBridge {
  readonly createVoiceSession: (target: VoiceTarget) => Promise<VoiceSession>;
  readonly connection: () => FakeConnection;
}

/** Runs public queue lifecycle coverage against one package's real adapter bridge. */
export function adapterLifecycleSuite(name: string, createBridge: () => AdapterLifecycleBridge): void {
  describe(`${name} lifecycle`, () => {
    beforeEach(resetNative);

    it("moves one guild queue and native connection without ending its active item", async () => {
      const bridge = createBridge();
      const distube = createDisTube(bridge);
      const finished = vi.fn();
      const failed = vi.fn();
      distube.on(Events.QueueItemFinished, finished);
      distube.on(Events.QueueItemFailed, failed);

      const firstStarted = waitForStart(distube);
      const first = await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL_A }, song("A"));
      await firstStarted;
      const activeId = first.queue.state.current?.id;

      const second = await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL_B }, song("B"));

      expect(second.queue).toBe(first.queue);
      expect(distube.queues.size).toBe(1);
      expect(native.connections).toHaveLength(1);
      expect(bridge.connection().rejoin).toHaveBeenCalledTimes(1);
      expect(first.queue.state.current?.id).toBe(activeId);
      expect(finished).not.toHaveBeenCalled();
      expect(failed).not.toHaveBeenCalled();
    });

    it("retires native playback before destroying the voice connection on leave", async () => {
      const bridge = createBridge();
      const distube = createDisTube(bridge);
      const started = waitForStart(distube);
      await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL_A }, song("A"));
      await started;
      const connection = bridge.connection();
      const decoder = latest.child;
      const order: string[] = [];
      const outcomes: string[] = [];
      distube.on(Events.QueueItemFinished, () => outcomes.push("finished"));
      distube.on(Events.QueueItemFailed, () => outcomes.push("failed"));
      connection.subscription.unsubscribe.mockImplementationOnce(() => {
        order.push("unsubscribe");
      });
      latest.player.stop
        .mockImplementationOnce(() => {
          order.push("queue stop");
          return true;
        })
        .mockImplementationOnce(() => {
          order.push("release stop");
          return true;
        });
      decoder.kill.mockImplementationOnce(signal => {
        order.push("kill");
        decoder.signalCode = signal;
        queueMicrotask(() => decoder.close(null, signal));
        return true;
      });
      decoder.once("close", () => order.push("close"));
      connection.destroy.mockImplementationOnce(() => {
        order.push("destroy");
        connection.transition({ status: "destroyed" });
      });

      await distube.voices.leave(GUILD);

      expect(order).toEqual(["queue stop", "kill", "close", "unsubscribe", "release stop", "destroy"]);
      expect(distube.getQueue(GUILD)).toBeUndefined();
      latest.player.transition({ status: "idle" });
      decoder.close(0, null);
      await settle();
      expect(outcomes).toEqual([]);
    });

    it("publishes one failed item for a post-start FFmpeg exit and never finishes it", async () => {
      const bridge = createBridge();
      const distube = createDisTube(bridge);
      const started = waitForStart(distube);
      const failed = waitForFailure(distube);
      const finished = vi.fn();
      distube.on(Events.QueueItemFinished, finished);
      await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL_A }, song("A"));
      await started;

      latest.child.close(1, null);
      await failed;
      await settle();

      expect(finished).not.toHaveBeenCalled();
    });

    it("does not expose a native AudioResource through queue.item.failed", async () => {
      const bridge = createBridge();
      const distube = createDisTube(bridge);
      const started = waitForStart(distube);
      const failed = new Promise<Error>(resolve => {
        distube.once(Events.QueueItemFailed, event => resolve(event.error));
      });
      await distube.play({ guildId: GUILD, voiceChannelId: CHANNEL_A }, song("A"));
      await started;
      const resource = latest.resource;

      latest.player.emit("error", audioPlayerError(resource, new Error("native audio player failed")));

      expect(causeChainContains(await failed, resource)).toBe(false);
    });
  });
}

function createDisTube(bridge: AdapterLifecycleBridge): DisTube {
  const adapter: Adapter = {
    createVoiceSession: bridge.createVoiceSession,
    engine: new DiscordVoiceEngine(undefined, async () => undefined),
  };
  return new DisTube({ adapter, plugins: [localSource()] });
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

/** The public error chain must never retain the native AudioResource held by AudioPlayerError. */
function causeChainContains(error: Error, resource: unknown): boolean {
  let current: Error | undefined = error;
  while (current) {
    if (Reflect.get(current, "resource") === resource) return true;
    current = current.cause instanceof Error ? current.cause : undefined;
  }
  return false;
}
