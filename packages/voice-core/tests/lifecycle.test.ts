import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { DisTube, Song } from "distube";
import type {
  Adapter,
  PlaybackContext,
  PlaybackPreparation,
  PluginContext,
  SourceOperationOptions,
  SourcePlugin,
  VoiceSession,
  VoiceTarget,
} from "distube/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { createMedia, fileReader, type MediaFixtures } from "./support/media";
import {
  audioPlayerError,
  type FakeConnection,
  gatewayAdapter,
  latest,
  native,
  resetNative,
  settle,
} from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const GUILD = "guild";
const CHANNEL_A = "channel-a";
const CHANNEL_B = "channel-b";

interface AdapterLifecycleBridge {
  readonly createVoiceSession: (target: VoiceTarget) => Promise<VoiceSession>;
  readonly connection: () => FakeConnection;
}

const gateway = gatewayAdapter();
let media: MediaFixtures;
let hour: Buffer;
/** The stream resource a song with this ID plays instead of the hour-long file. */
const streams = new Map<string, PassThrough>();

beforeAll(async () => {
  media = await createMedia();
  hour = await readFile(media.hour);
}, 30_000);
afterAll(() => media.cleanup());

/** The gateway session every Discord adapter returns, joined through the fake native library. */
function createBridge(): AdapterLifecycleBridge {
  return {
    createVoiceSession: target =>
      DiscordVoiceSession.connect({
        guildId: target.guildId,
        channelId: target.channelId,
        clientUserId: "bot",
        adapterCreator: gateway.creator,
        selfDeaf: true,
        selfMute: false,
        connectionTimeoutMs: 15_000,
      }),
    connection: () => latest.connection,
  };
}

describe("DiscordVoiceSession queue lifecycle", () => {
  beforeEach(resetNative);

  it("moves one guild queue and native connection without ending its active item", async () => {
    const bridge = createBridge();
    const distube = createDisTube(bridge);
    const finished = vi.fn();
    const failed = vi.fn();
    distube.on("queue.item.finished", finished);
    distube.on("queue.item.failed", failed);

    const firstStarted = waitForStart(distube);
    const first = await distube.play({ guildId: GUILD, id: CHANNEL_A }, song("A"));
    await firstStarted;
    const activeId = first.current?.id;

    const second = await distube.play({ guildId: GUILD, id: CHANNEL_B }, song("B"));

    expect(second).toBe(first);
    expect(distube.queues.size).toBe(1);
    expect(native.connections).toHaveLength(1);
    expect(first.current?.id).toBe(activeId);
    expect(finished).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
  });

  it("retires native playback before destroying the voice connection on leave", async () => {
    const bridge = createBridge();
    const distube = createDisTube(bridge);
    const started = waitForStart(distube);
    await distube.play({ guildId: GUILD, id: CHANNEL_A }, song("A"));
    await started;
    const connection = bridge.connection();
    const order: string[] = [];
    const outcomes: string[] = [];
    distube.on("queue.item.finished", () => outcomes.push("finished"));
    distube.on("queue.item.failed", () => outcomes.push("failed"));
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
    const inputs = readers.at(-1)?.readables ?? [];
    expect(inputs.some(readable => !readable.destroyed)).toBe(true);
    connection.destroy.mockImplementationOnce(() => {
      order.push(inputs.every(readable => readable.destroyed) ? "destroy after inputs" : "destroy");
      connection.transition({ status: "destroyed" });
    });

    await distube.voices.leave(GUILD);

    expect(order).toEqual(["queue stop", "unsubscribe", "release stop", "destroy after inputs"]);
    expect(distube.getQueue(GUILD)).toBeUndefined();
    latest.player.transition({ status: "idle" });
    await settle();
    expect(outcomes).toEqual([]);
  });

  it("publishes one failed item for a post-start input failure and never finishes it", async () => {
    const bridge = createBridge();
    const distube = createDisTube(bridge);
    const started = waitForStart(distube);
    const failed = waitForFailure(distube);
    const finished = vi.fn();
    distube.on("queue.item.finished", finished);
    const stream = new PassThrough();
    stream.write(hour.subarray(0, 400_000));
    streams.set("S", stream);
    await distube.play({ guildId: GUILD, id: CHANNEL_A }, song("S"));
    await started;

    stream.destroy(new Error("socket reset"));
    latest.resource.input.resume();
    await failed;
    await settle();

    expect(finished).not.toHaveBeenCalled();
  });

  it("does not expose a native AudioResource through queue.item.failed", async () => {
    const bridge = createBridge();
    const distube = createDisTube(bridge);
    const started = waitForStart(distube);
    const failed = new Promise<Error>(resolve => {
      const unsubscribe = distube.on("queue.item.failed", event => {
        unsubscribe();
        resolve(event.error);
      });
    });
    await distube.play({ guildId: GUILD, id: CHANNEL_A }, song("A"));
    await started;
    const resource = latest.resource;

    latest.player.emit("error", audioPlayerError(resource, new Error("native audio player failed")));

    expect(causeChainContains(await failed, resource)).toBe(false);
  });
});

const readers: Awaited<ReturnType<typeof fileReader>>[] = [];

function createDisTube(bridge: AdapterLifecycleBridge): DisTube {
  const adapter: Adapter = {
    normalizeTarget: target => ({
      guildId: "guildId" in target ? target.guildId : target.guild.id,
      channelId: target.id,
    }),
    createVoiceSession: bridge.createVoiceSession,
    engine: new DiscordVoiceEngine(undefined, async () => undefined),
  };
  return new DisTube({ adapter, sources: [localSource()] });
}

function localSource(): SourcePlugin {
  return {
    name: "local",
    initialize: (_context: PluginContext): void => undefined,
    dispose: (): void => undefined,
    search: async (_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> => [],
    resolve: async (_url: string, _options?: SourceOperationOptions): Promise<undefined> => undefined,
    stream: async (value: Song, _context: PlaybackContext): Promise<PlaybackPreparation> => {
      const stream = streams.get(value.id);
      if (stream) return { kind: "resource", resource: { kind: "stream", stream } };
      // No range completes, so the track holds an open input until it is closed.
      const reader = await fileReader(media.hour, start => {
        const partial = new PassThrough();
        partial.write(hour.subarray(start, start + 100_000));
        return partial;
      });
      readers.push(reader);
      return { kind: "resource", resource: reader.resource };
    },
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

function waitForStart(distube: DisTube): Promise<void> {
  return new Promise(resolve => {
    const unsubscribe = distube.on("queue.item.started", () => {
      unsubscribe();
      resolve();
    });
  });
}

function waitForFailure(distube: DisTube): Promise<void> {
  return new Promise(resolve => {
    const unsubscribe = distube.on("queue.item.failed", () => {
      unsubscribe();
      resolve();
    });
  });
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
