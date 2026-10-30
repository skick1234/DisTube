import { getVoiceConnection, type VoiceConnection } from "@discordjs/voice";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { PlaybackResource, Player, TrackEnd, VoiceSessionEvent } from "distube/integrations";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { createMedia, type MediaFixtures, peaks, pitches, stepHz } from "./support/media";
import { CHANNEL, gatewayAdapter, settle } from "./support/native";
import { type HeardPacket, serveAudio, serveVoiceGateway, type VoiceGatewayServer } from "./support/real";

type Gateway = ReturnType<typeof gatewayAdapter>;

const TIMEOUT_MS = 1_000;

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

/** A session joined through a fake gateway whose voice server updates name a local voice server. */
async function joined(clientUserId = "bot"): Promise<{
  server: VoiceGatewayServer;
  gateway: Gateway;
  session: DiscordVoiceSession;
  events: VoiceSessionEvent[];
}> {
  const server = await serveVoiceGateway();
  cleanups.push(() => server.stop().catch(() => undefined));
  const gateway = gatewayAdapter(clientUserId, server.endpoint);
  const session = await DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId,
    adapterCreator: gateway.creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: TIMEOUT_MS,
    channelBitrate: () => 64_000,
    preflight: () => undefined,
  });
  cleanups.push(() => session.release().catch(() => undefined));
  const events: VoiceSessionEvent[] = [];
  session.subscribe(event => events.push(event));
  return { server, gateway, session, events };
}

/** A joined session whose real `@discordjs/voice` connection has reached Ready. */
async function connected(
  clientUserId = "bot",
): Promise<Awaited<ReturnType<typeof joined>> & { connection: VoiceConnection }> {
  const joinedSession = await joined(clientUserId);
  const connection = await DiscordVoiceSession.connectionOf(joinedSession.session);
  if (!connection) throw new Error("Expected the session to attach a voice connection");
  return { ...joinedSession, connection };
}

function joins(gateway: Gateway): unknown[] {
  return gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id !== null);
}

function leaves(gateway: Gateway): unknown[] {
  return gateway.sendPayload.mock.calls.filter(([payload]) => payload.d.channel_id === null);
}

function networkingOf(connection: VoiceConnection): unknown {
  return "networking" in connection.state ? connection.state.networking : undefined;
}

describe("DiscordVoiceSession over the real voice library", () => {
  it("survives a refused voice reconnect without an uncaught error and disconnects once after three rejoins", async () => {
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    cleanups.push(async () => process.off("uncaughtException", uncaught));
    const { server, gateway, events } = await connected();

    await server.stop();
    await vi.waitFor(
      () => {
        expect(uncaught).not.toHaveBeenCalled();
        expect(events).toHaveLength(1);
      },
      { timeout: 2_000 },
    );
    await settle();

    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    expect(joins(gateway)).toHaveLength(4);
    expect(leaves(gateway)).toHaveLength(1);
  });

  it("rejoins through the gateway after a 4006 close and reaches Ready on a new voice socket", async () => {
    const { server, gateway, events, connection } = await connected();
    const networking = networkingOf(connection);

    server.close(4006);
    await vi.waitFor(() => expect(server.connections).toBe(2), { timeout: 2_000 });
    await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 2_000 });

    expect(networkingOf(connection) === networking, "the voice networking was kept").toBe(false);
    expect(joins(gateway)).toHaveLength(2);
    expect(events.filter(event => event.type === "disconnected")).toEqual([]);
  });

  it("disconnects once when a 4006 rejoin does not reach Ready within the join timeout", async () => {
    const { server, gateway, events } = await connected();
    server.answers = false;

    server.close(4006);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 3 * TIMEOUT_MS });

    expect(events).toEqual([{ type: "disconnected", reason: "failed", error: expect.any(Error) }]);
    expect(joins(gateway)).toHaveLength(2);
    expect(leaves(gateway)).toHaveLength(1);
  });

  it("gives each client user in one guild its own connection and keeps one when the other releases", async () => {
    const first = await connected("bot");
    const second = await connected("other-bot");

    await first.session.release();
    await settle();

    expect(second.connection).not.toBe(first.connection);
    expect(first.connection.state.status).toBe("destroyed");
    expect(second.connection.state.status).toBe("ready");
    expect(getVoiceConnection("guild", "other-bot")).toBe(second.connection);
    expect(second.events).toEqual([]);
  });

  it.each([4004, 4011, 4016, 4017, 4021, 4022])("disconnects once naming close %i without a rejoin", async code => {
    const { server, gateway, events } = await connected();

    server.close(code);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2_000 });
    await settle();

    expect(events).toEqual([
      {
        type: "disconnected",
        reason: "failed",
        error: expect.objectContaining({ message: expect.stringContaining(String(code)) }),
      },
    ]);
    expect(joins(gateway)).toHaveLength(1);
    expect(leaves(gateway)).toHaveLength(1);
    expect(server.connections).toBe(1);
  });

  it.each([
    ["join", (session: DiscordVoiceSession) => session.join(CHANNEL, { selfMute: true })],
    ["setSelfState", (session: DiscordVoiceSession) => session.setSelfState({ selfMute: true })],
  ])("keeps the voice networking and publishes nothing when %s changes only a self flag", async (_name, write) => {
    const { server, session, events, connection } = await connected();
    const networking = networkingOf(connection);

    await write(session);
    await settle();

    expect(session.selfMute).toBe(true);
    expect(networkingOf(connection) === networking, "the voice networking was replaced").toBe(true);
    expect(connection.state.status).toBe("ready");
    expect(server.connections).toBe(1);
    expect(events).toEqual([]);
  });

  it("reports a connection user code destroyed through onClosed once and plays on a new Player, never closing on release", async () => {
    const { session } = await joined();
    const origin = await serveAudio();
    cleanups.push(() => origin.stop());
    const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500, report: () => undefined });
    const play = (player: Awaited<ReturnType<typeof engine.createPlayer>>) => {
      const { promise: started, resolve } = Promise.withResolvers<void>();
      const ended = player.play(
        { kind: "url", url: origin.url },
        { signal: new AbortController().signal, onStart: resolve },
      );
      void ended.catch(() => undefined);
      return { started, ended };
    };
    const onClosed = vi.fn();
    const first = await engine.createPlayer(session, { onClosed });
    const track = play(first);
    await track.started;

    getVoiceConnection("guild", "bot")?.destroy();

    const failure: unknown = await track.ended.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(onClosed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    await expect(first.setVolume(50)).rejects.toThrow();
    await first.release();
    expect(onClosed).toHaveBeenCalledTimes(1);

    const replacementClosed = vi.fn();
    const replacement = await engine.createPlayer(session, { onClosed: replacementClosed });
    await play(replacement).started;
    await replacement.release();
    expect(replacementClosed).not.toHaveBeenCalled();
  });
});

const BUFFER_MS = 500;
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

let media: MediaFixtures;
beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());

/** A built-in Player on a session whose real voice connection sends to a local voice server, with its first track started. */
async function playing(resource: PlaybackResource): Promise<{
  server: VoiceGatewayServer;
  player: Player;
  ended: Promise<TrackEnd>;
}> {
  const { server, session } = await joined();
  const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: BUFFER_MS, report: () => undefined });
  const player = await engine.createPlayer(session, { onClosed: () => undefined });
  cleanups.push(() => player.release());
  const { promise: started, resolve } = Promise.withResolvers<void>();
  const ended = player.play(resource, { signal: new AbortController().signal, onStart: resolve });
  void ended.catch(() => undefined);
  await started;
  return { server, player, ended };
}

/** The first `count` packets the server heard at or after `since`, waiting for them in real time. */
async function hear(server: VoiceGatewayServer, since: number, count: number): Promise<HeardPacket[]> {
  const after = (): HeardPacket[] => server.heard.filter(packet => packet.at >= since);
  await vi.waitFor(() => expect(after().length).toBeGreaterThanOrEqual(count), {
    timeout: since - performance.now() + count * 20 + 2_000,
    interval: 20,
  });
  return after().slice(0, count);
}

interface Heard {
  readonly at: number;
  readonly level: number;
  readonly hz: number;
}

/** Everything the server heard so far, decoded in one pass as a listener would hear it. */
async function decodeHeard(server: VoiceGatewayServer): Promise<Heard[]> {
  const heard = [...server.heard];
  const opus = heard.map(packet => packet.opus);
  const [levels, hz] = await Promise.all([peaks(opus, media.opus), pitches(opus, media.opus)]);
  return heard.map((packet, index) => ({ at: packet.at, level: levels[index] ?? 0, hz: hz[index] ?? 0 }));
}

function median(values: readonly number[]): number {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
}

/** The median level of the last 10 packets heard before `change` resolved and the levels of 25 heard from 2 × bufferMs after it. */
async function levelsAround(
  server: VoiceGatewayServer,
  change: () => Promise<void>,
): Promise<{ before: number; after: number[] }> {
  await hear(server, performance.now() + 300, 10);
  await change();
  const acknowledged = performance.now();
  const settled = acknowledged + 2 * BUFFER_MS;
  await hear(server, settled, 25);
  const heard = await decodeHeard(server);
  return {
    before: median(
      heard
        .filter(packet => packet.at < acknowledged)
        .slice(-10)
        .map(packet => packet.level),
    ),
    after: heard
      .filter(packet => packet.at >= settled)
      .slice(0, 25)
      .map(packet => packet.level),
  };
}

/** The `steps` second a packet's tone belongs to, or `undefined` when it is quiet or between steps. */
function stepSecond({ level, hz }: Heard): number | undefined {
  const second = Math.round((hz - stepHz(0)) / (stepHz(1) - stepHz(0)));
  return level > 0.2 && Math.abs(hz - stepHz(second)) < 30 ? second : undefined;
}

describe("built-in playback heard by a local voice server", () => {
  it("sends steady AAC-to-Opus playback every 20 ms with no silence frame, no gap over 60 ms and p99 spacing under 40 ms", async () => {
    const { server } = await playing({ kind: "file", path: media.aac });

    const steady = await hear(server, performance.now() + 500, 150);

    const spacing = steady.slice(1).map((packet, index) => packet.at - (steady[index] as HeardPacket).at);
    const sorted = spacing.toSorted((a, b) => a - b);
    expect(steady.filter(packet => packet.opus.equals(SILENCE_FRAME))).toEqual([]);
    expect(sorted.at(-1)).toBeLessThan(60);
    expect(sorted[Math.floor(0.99 * sorted.length)]).toBeLessThan(40);
    expect((steady.at(-1) as HeardPacket).at - (steady[0] as HeardPacket).at).toBeGreaterThan(149 * 19);
  });

  it("halves the heard level of a playing track after a volume change to 50", async () => {
    const { server, player } = await playing({ kind: "file", path: media.steps });

    const { before, after } = await levelsAround(server, () => player.setVolume(50));

    expect(before).toBeGreaterThan(0.4);
    expect(after).toHaveLength(25);
    expect(Math.min(...after) / before).toBeGreaterThan(0.45);
    expect(Math.max(...after) / before).toBeLessThan(0.55);
  });

  it("removes a centred tone from a playing track after a karaoke filter change", async () => {
    const { server, player } = await playing({ kind: "file", path: media.steps });

    const { before, after } = await levelsAround(server, () => player.setFilters([{ name: "karaoke" }]));

    expect(before).toBeGreaterThan(0.4);
    expect(after).toHaveLength(25);
    expect(Math.max(...after) / before).toBeLessThan(0.1);
  });

  it("drops the read-ahead at a seek to 6, so second 6's tone follows within three packets while position reads 6, then second 7's", async () => {
    const { server, player } = await playing({ kind: "file", path: media.steps });
    await hear(server, performance.now() + 300, 10);

    await player.seek(6);
    const sought = performance.now();
    const position = player.position;
    await hear(server, sought, 100);

    const seconds = (await decodeHeard(server)).filter(packet => packet.at >= sought).map(stepSecond);
    const landed = seconds.indexOf(6);
    expect(position).toBe(6);
    expect(landed).toBeGreaterThanOrEqual(0);
    expect(landed).toBeLessThanOrEqual(3);
    const sixth = seconds.slice(landed);
    const next = sixth.findIndex(second => second !== 6 && second !== undefined);
    expect(sixth[next]).toBe(7);
    expect(next).toBeGreaterThanOrEqual(48);
    expect(next).toBeLessThanOrEqual(52);
  });

  it("fails the track after 15 s of silence frames when its source keeps sending bytes but no audio", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    cleanups.push(async () => vi.useRealTimers());
    const bytes = await readFile(media.steps);
    const stream = new PassThrough();
    stream.write(bytes.subarray(0, 24_000));
    const { server, ended } = await playing({ kind: "stream", stream });
    const silent = (): number => server.heard.filter(packet => packet.opus.equals(SILENCE_FRAME)).length;
    await vi.waitFor(() => expect(silent()).toBeGreaterThan(0), { timeout: 5_000, interval: 20 });

    for (const byte of [24_000, 24_001, 24_002, 24_003]) {
      await vi.advanceTimersByTimeAsync(5_000);
      stream.write(bytes.subarray(byte, byte + 1));
    }

    await expect(ended).rejects.toThrow("stopped before the track ended");
    await settle();
    expect(silent()).toBeGreaterThanOrEqual(750);
    expect(silent()).toBeLessThan(800);
  });
});
