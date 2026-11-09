import { getVoiceConnection, type VoiceConnection } from "@discordjs/voice";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { Diagnostic, PlaybackResource, Player, TrackEnd, VoiceSessionEvent } from "distube/integrations";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { createMedia, type MediaFixtures, peaks, pitches, stepHz } from "./support/media";
import { CHANNEL, gatewayAdapter, settle, noPlatform } from "./support/native";
import { type HeardPacket, serveAudio, serveVoiceGateway, type VoiceGatewayServer } from "./support/real";

type Gateway = ReturnType<typeof gatewayAdapter>;

const TIMEOUT_MS = 1_000;
const RECONNECT_MS = 2_000;
const ROUND_MS = 5_000;

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

interface JoinedOptions {
  readonly clientUserId?: string;
  readonly heartbeatMs?: number;
  readonly reconnectTimeoutMs?: number;
}

async function joined({
  clientUserId = "bot",
  heartbeatMs,
  reconnectTimeoutMs = RECONNECT_MS,
}: JoinedOptions = {}): Promise<{
  server: VoiceGatewayServer;
  gateway: Gateway;
  session: DiscordVoiceSession;
  connection: VoiceConnection;
  events: VoiceSessionEvent[];
  reports: Diagnostic[];
  timeline: string[];
}> {
  const server = await serveVoiceGateway();
  cleanups.push(() => server.stop().catch(() => undefined));
  if (heartbeatMs !== undefined) server.heartbeatMs = heartbeatMs;
  const gateway = gatewayAdapter(clientUserId, server.endpoint);
  const reports: Diagnostic[] = [];
  const timeline: string[] = [];
  const session = await DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId,
    adapterCreator: gateway.creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: TIMEOUT_MS,
    reconnectTimeoutMs,
    report: diagnostic => {
      reports.push(diagnostic);
      timeline.push(diagnostic.stage);
    },
    channelBitrate: () => 64_000,
    preflight: () => undefined,
  });
  cleanups.push(() => session.release().catch(() => undefined));
  const events: VoiceSessionEvent[] = [];
  session.subscribe(event => {
    events.push(event);
    timeline.push(event.type);
  });
  const connection = getVoiceConnection("guild", clientUserId);
  if (!connection) throw new Error("Expected the join to open a voice connection");
  return { server, gateway, session, connection, events, reports, timeline };
}

function channels(gateway: Gateway): (string | null)[] {
  return gateway.sendPayload.mock.calls.map(([payload]) => payload.d.channel_id);
}

function joins(gateway: Gateway): unknown[] {
  return channels(gateway).filter(channelId => channelId !== null);
}

function leaves(gateway: Gateway): unknown[] {
  return channels(gateway).filter(channelId => channelId === null);
}

function networkingOf(connection: VoiceConnection): unknown {
  return "networking" in connection.state ? connection.state.networking : undefined;
}

function failed(): VoiceSessionEvent {
  return { type: "disconnected", reason: "failed", error: expect.any(Error) };
}

describe("DiscordVoiceSession over the real voice library", () => {
  it("resolves the join on a Ready connection the library opened from one join, then plays on it with no second join", async () => {
    const { server, gateway, session, connection, events } = await joined();
    const networking = networkingOf(connection);
    expect(connection.state.status).toBe("ready");
    expect(session.gateway).toEqual({
      channelId: CHANNEL,
      sessionId: "session",
      token: "token",
      endpoint: server.endpoint,
    });

    const origin = await serveAudio();
    cleanups.push(() => origin.stop());
    const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500, report: () => undefined }, noPlatform);
    for (let round = 0; round < 2; round += 1) {
      const player = await engine.createPlayer(session, { onClosed: () => undefined });
      const { promise: started, resolve } = Promise.withResolvers<void>();
      void player.play({ kind: "url", url: origin.url }, { signal: new AbortController().signal, onStart: resolve });
      await started;
      await player.release();
    }

    expect(channels(gateway)).toEqual([CHANNEL]);
    expect(networkingOf(connection) === networking, "the voice networking was replaced").toBe(true);
    expect(connection.state.status).toBe("ready");
    expect(server.connections).toBe(1);
    expect(events).toEqual([]);
  });

  it("leaves before the library's rejoin after a 4006 close, so the platform's fresh credentials reach Ready", async () => {
    const { server, gateway, events, connection } = await joined();
    const networking = networkingOf(connection);

    server.close(4006);
    await vi.waitFor(() => expect(server.connections).toBe(2), { timeout: 2_000 });
    await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 2_000 });

    expect(networkingOf(connection) === networking, "the voice networking was kept").toBe(false);
    expect(channels(gateway)).toEqual([CHANNEL, null, CHANNEL]);
    expect(events).toEqual([{ type: "connected", gateway: expect.any(Object) }]);
  });

  it("disconnects once when a 4006 recovery does not reach Ready within reconnectTimeoutMs", async () => {
    const { server, gateway, events } = await joined();
    server.answers = false;

    server.close(4006);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 3 * TIMEOUT_MS });
    await settle();

    expect(events).toEqual([failed()]);
    expect(joins(gateway)).toHaveLength(2);
    expect(leaves(gateway)).toHaveLength(2);
  });

  it("sends no second leave within a second of the last while a gone voice server fails each rejoin, then disconnects and leaves once at the deadline", async () => {
    const uncaught = vi.fn();
    process.on("uncaughtException", uncaught);
    cleanups.push(async () => process.off("uncaughtException", uncaught));
    const { server, gateway, events } = await joined();

    await server.stop();
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2 * RECONNECT_MS });
    await settle();

    expect(uncaught).not.toHaveBeenCalled();
    expect(events).toEqual([failed()]);
    expect(leaves(gateway)).toHaveLength(2);
  });

  it.each([4014, 4022, 4006])(
    "publishes removed at once when the platform empties the bot's voice state and closes the socket with %i",
    async code => {
      const { server, gateway, events } = await joined();

      gateway.state(null);
      server.close(code);
      await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: TIMEOUT_MS / 2 });
      await settle();

      expect(events).toEqual([{ type: "disconnected", reason: "removed" }]);
      expect(joins(gateway)).toHaveLength(1);
    },
  );

  it("moves to another channel on a new voice socket, publishes the moved credentials and reports no recovery", async () => {
    const { server, gateway, session, events, reports } = await joined();

    await session.join("other");
    await settle();

    expect(reports).toEqual([]);
    expect(session.channelId).toBe("other");
    expect(channels(gateway)).toEqual([CHANNEL, "other"]);
    expect(server.connections).toBe(2);
    expect(events).toEqual([{ type: "connected", gateway: expect.objectContaining({ channelId: "other" }) }]);
  });

  it("keeps the voice through a move whose old socket the platform closes with 4022 before the new server update", async () => {
    const { server, gateway, session, events } = await joined();
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => {
        gateway.state("other");
        server.close(4022);
        setTimeout(() => gateway.server("moved"), 50);
      });
      return true;
    });
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => gateway.state("other"));
      return true;
    });

    await session.join("other");
    await settle();

    expect(session.channelId).toBe("other");
    expect(channels(gateway)).toEqual([CHANNEL, "other", "other"]);
    expect(events).toEqual([
      {
        type: "connected",
        gateway: expect.objectContaining({ channelId: "other", token: "moved" }),
      },
    ]);
  });

  it("moves when the platform's new server update reaches Ready before the voice state names the channel", async () => {
    const { gateway, session, events, connection } = await joined();
    const networking = networkingOf(connection);
    gateway.sendPayload.mockImplementationOnce(() => {
      queueMicrotask(() => gateway.server("moved"));
      return true;
    });

    const moving = session.join("other");
    await vi.waitFor(() => {
      expect(networkingOf(connection) === networking, "the voice networking was kept").toBe(false);
      expect(connection.state.status).toBe("ready");
    });
    expect(events).toEqual([]);
    gateway.state("other");
    await moving;

    expect(session.channelId).toBe("other");
    expect(events).toEqual([
      {
        type: "connected",
        gateway: expect.objectContaining({ channelId: "other", token: "moved" }),
      },
    ]);
  });

  it("rejects a self flag change the gateway refuses and keeps the Ready voice socket", async () => {
    const { server, gateway, session, events, connection } = await joined();
    const networking = networkingOf(connection);
    gateway.sendPayload.mockReturnValueOnce(false);

    await expect(session.setSelfState({ selfMute: true })).rejects.toThrow("Discord gateway is unavailable");
    await settle();

    expect(session.selfMute).toBe(false);
    expect(networkingOf(connection) === networking, "the voice networking was replaced").toBe(true);
    expect(connection.state.status).toBe("ready");
    expect(server.connections).toBe(1);
    expect(events).toEqual([]);
  });

  it("gives each client user in one guild its own connection and keeps one when the other releases", async () => {
    const first = await joined();
    const second = await joined({ clientUserId: "other-bot" });

    await first.session.release();
    await settle();

    expect(second.connection).not.toBe(first.connection);
    expect(first.connection.state.status).toBe("destroyed");
    expect(second.connection.state.status).toBe("ready");
    expect(getVoiceConnection("guild", "other-bot")).toBe(second.connection);
    expect(second.events).toEqual([]);
  });

  it.each([4004, 4011, 4016, 4017, 4021])("disconnects once naming close %i without a rejoin", async code => {
    const { server, gateway, events, reports, timeline } = await joined();

    server.close(code);
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2_000 });
    await settle();

    expect(timeline).toEqual(["voice.recovery.failed", "disconnected"]);
    expect(reports[0]).toMatchObject({
      severity: "error",
      guildId: "guild",
      error: expect.any(Error),
      data: { closeCode: code, rounds: 0 },
    });
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
    const { server, session, events, connection } = await joined();
    const networking = networkingOf(connection);

    await write(session);
    await settle();

    expect(session.selfMute).toBe(true);
    expect(networkingOf(connection) === networking, "the voice networking was replaced").toBe(true);
    expect(connection.state.status).toBe("ready");
    expect(server.connections).toBe(1);
    expect(events).toEqual([]);
  });

  it("ends the voice once when user code destroys the connection, calling onClosed once and never on release", async () => {
    const { session, events } = await joined();
    const origin = await serveAudio();
    cleanups.push(() => origin.stop());
    const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500, report: () => undefined }, noPlatform);
    const onClosed = vi.fn();
    const player = await engine.createPlayer(session, { onClosed });
    const { promise: started, resolve } = Promise.withResolvers<void>();
    const ended = player.play(
      { kind: "url", url: origin.url },
      { signal: new AbortController().signal, onStart: resolve },
    );
    void ended.catch(() => undefined);
    await started;

    getVoiceConnection("guild", "bot")?.destroy();

    const failure: unknown = await ended.then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: "VOICE_FAILED" });
    expect(onClosed).toHaveBeenCalledExactlyOnceWith(failure);
    expect(events).toEqual([failed()]);
    await player.release();
    expect(onClosed).toHaveBeenCalledTimes(1);
    await expect(engine.createPlayer(session, { onClosed })).rejects.toMatchObject({ code: "INVALID_STATE" });
  });
});

const BUFFER_MS = 500;
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);

let media: MediaFixtures;
beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());

async function playing(
  resource: PlaybackResource,
  options: JoinedOptions = {},
): Promise<{
  server: VoiceGatewayServer;
  connection: VoiceConnection;
  player: Player;
  ended: Promise<TrackEnd>;
  reports: Diagnostic[];
}> {
  const { server, session, connection, reports } = await joined(options);
  const engine = new DiscordVoiceEngine(
    {
      opusComplexity: 10,
      bufferMs: BUFFER_MS,
      report: diagnostic => void reports.push(diagnostic),
    },
    noPlatform,
  );
  const player = await engine.createPlayer(session, { onClosed: () => undefined });
  cleanups.push(() => player.release());
  const { promise: started, resolve } = Promise.withResolvers<void>();
  const ended = player.play(resource, { signal: new AbortController().signal, onStart: resolve });
  void ended.catch(() => undefined);
  await started;
  return { server, connection, player, ended, reports };
}

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

async function decodeHeard(server: VoiceGatewayServer): Promise<Heard[]> {
  const heard = [...server.heard];
  const opus = heard.map(packet => packet.opus);
  const [levels, hz] = await Promise.all([peaks(opus, media.opus), pitches(opus, media.opus)]);
  return heard.map((packet, index) => ({ at: packet.at, level: levels[index] ?? 0, hz: hz[index] ?? 0 }));
}

function median(values: readonly number[]): number {
  return values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? Number.NaN;
}

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

function stepSecond({ level, hz }: Heard): number | undefined {
  const second = Math.round((hz - stepHz(0)) / (stepHz(1) - stepHz(0)));
  return level > 0.2 && Math.abs(hz - stepHz(second)) < 30 ? second : undefined;
}

async function firstJoin(answer: (gateway: Gateway) => void, signal?: AbortSignal) {
  const server = await serveVoiceGateway();
  cleanups.push(() => server.stop().catch(() => undefined));
  const gateway = gatewayAdapter("bot", server.endpoint);
  answer(gateway);
  const report = vi.fn<(diagnostic: Diagnostic) => void>();
  const started = performance.now();
  const connecting = DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL,
    clientUserId: "bot",
    adapterCreator: gateway.creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: TIMEOUT_MS,
    reconnectTimeoutMs: RECONNECT_MS,
    channelBitrate: () => 64_000,
    preflight: () => undefined,
    report,
    ...(signal ? { signal } : {}),
  });
  connecting.then(
    session => cleanups.push(() => session.release()),
    () => undefined,
  );
  return { server, gateway, report, connecting, elapsed: () => performance.now() - started };
}

function stateWithoutServer(gateway: Gateway): void {
  gateway.sendPayload.mockImplementationOnce(() => {
    queueMicrotask(() => gateway.state(CHANNEL));
    return true;
  });
}

describe("built-in first join", () => {
  it("leaves, waits for the leave's voice state and joins once more when the platform answers no first join with a voice server", async () => {
    const { server, gateway, report, connecting } = await firstJoin(adapter => {
      stateWithoutServer(adapter);
      adapter.sendPayload.mockImplementationOnce(() => true);
    });

    await vi.waitFor(() => expect(channels(gateway)).toEqual([CHANNEL, null]), { timeout: 2 * TIMEOUT_MS });
    await settle();
    const beforeLeaveState = channels(gateway);
    gateway.state(null);
    const session = await connecting;

    expect(beforeLeaveState).toEqual([CHANNEL, null]);
    expect(channels(gateway)).toEqual([CHANNEL, null, CHANNEL]);
    expect(session.gateway?.endpoint).toBe(server.endpoint);
    expect(report.mock.calls).toEqual([
      [
        {
          severity: "info",
          stage: "voice.join.retried",
          message: expect.any(String),
          guildId: "guild",
          data: { channelId: CHANNEL },
        },
      ],
    ]);
  });

  it("rejects VOICE_FAILED marked transient after two joins the platform never answers, and sends no third join", async () => {
    const { gateway, connecting, elapsed } = await firstJoin(adapter => {
      stateWithoutServer(adapter);
      adapter.sendPayload.mockImplementationOnce(() => {
        queueMicrotask(() => adapter.state(null));
        return true;
      });
      stateWithoutServer(adapter);
    });

    const failure = await connecting.then(
      () => undefined,
      (error: unknown) => error,
    );
    await settle();

    expect(failure).toMatchObject({ name: "DisTubeError", code: "VOICE_FAILED", transient: true });
    expect(elapsed()).toBeGreaterThanOrEqual(2 * TIMEOUT_MS - 50);
    expect(joins(gateway)).toHaveLength(2);
  });

  it("rejects ABORTED and sends no third join when its signal aborts during the second try", async () => {
    const controller = new AbortController();
    const { gateway, report, connecting } = await firstJoin(adapter => {
      stateWithoutServer(adapter);
      adapter.sendPayload.mockImplementationOnce(() => {
        queueMicrotask(() => adapter.state(null));
        return true;
      });
      stateWithoutServer(adapter);
    }, controller.signal);

    await vi.waitFor(() => expect(joins(gateway)).toHaveLength(2), { timeout: 2 * TIMEOUT_MS });
    controller.abort(new Error("left"));
    const failure = await connecting.then(
      () => undefined,
      (error: unknown) => error,
    );
    await settle();

    expect(failure).toMatchObject({ name: "DisTubeError", code: "ABORTED" });
    expect(report).toHaveBeenCalledTimes(1);
    expect(joins(gateway)).toHaveLength(2);
  });
});

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

  it("reads the voice heartbeat round trip as ping and reports a 4006 recovery once with its close code and silent time", async () => {
    const { server, player, reports } = await playing({ kind: "file", path: media.steps }, { heartbeatMs: 50 });
    await vi.waitFor(() => expect(player.ping).toEqual(expect.any(Number)), { timeout: 2_000 });
    expect(reports.filter(diagnostic => diagnostic.stage === "voice.recovered")).toEqual([]);

    const closedAt = performance.now();
    server.close(4006);
    await vi.waitFor(() => expect(server.connections).toBe(2), { timeout: 2_000 });
    await hear(server, performance.now(), 5);
    const elapsed = performance.now() - closedAt;

    const reconnects = reports.filter(diagnostic => diagnostic.stage === "voice.recovered");
    expect(reconnects).toEqual([
      expect.objectContaining({
        severity: "warning",
        guildId: "guild",
        data: {
          closeCode: 4006,
          durationMs: expect.any(Number),
          rounds: 0,
          path: "library",
          trail: expect.stringMatching(/close:4006>.*ready$/),
        },
      }),
    ]);
    expect(reconnects[0]?.data?.durationMs).toBeGreaterThan(0);
    expect(reconnects[0]?.data?.durationMs).toBeLessThanOrEqual(elapsed);
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

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function recovered(reports: readonly Diagnostic[]): Diagnostic[] {
  return reports.filter(diagnostic => diagnostic.stage === "voice.recovered");
}

describe("built-in recovery after Ready", () => {
  const ROUND_TEST_MS = 15_000;

  it(
    "leaves and joins 5 s after a resume the voice server never answers, and reports the round",
    async () => {
      const { server, gateway, connection, events, reports } = await joined({ reconnectTimeoutMs: 8_000 });
      const closedAt = performance.now();

      server.close(1001);
      await vi.waitFor(() => expect(leaves(gateway)).toHaveLength(1), { timeout: ROUND_MS + 1_000 });
      const leftAfter = performance.now() - closedAt;
      await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 2_000 });
      await settle();

      expect(leftAfter).toBeGreaterThanOrEqual(ROUND_MS - 100);
      expect(channels(gateway)).toEqual([CHANNEL, null, CHANNEL]);
      expect(events).toEqual([{ type: "connected", gateway: expect.any(Object) }]);
      expect(recovered(reports)).toEqual([
        {
          severity: "warning",
          stage: "voice.recovered",
          message: expect.any(String),
          guildId: "guild",
          data: { durationMs: expect.any(Number), rounds: 1, path: "rejoin", trail: expect.stringMatching(/ready$/) },
        },
      ]);
    },
    ROUND_TEST_MS,
  );

  it(
    "rejoins after a 4014 while the bot's voice state still names the channel, and its own leave reads as no removal",
    async () => {
      const { server, gateway, connection, events } = await joined({ reconnectTimeoutMs: 8_000 });

      server.close(4014);
      await vi.waitFor(() => expect(connection.state.status).not.toBe("ready"));
      await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: ROUND_MS + 2_000 });
      await settle();

      expect(channels(gateway)).toEqual([CHANNEL, null, CHANNEL]);
      expect(events).toEqual([{ type: "connected", gateway: expect.any(Object) }]);
    },
    ROUND_TEST_MS,
  );

  it("leaves again before the library's join for a second 4006 in one outage", async () => {
    const { server, gateway, connection, events } = await joined({ reconnectTimeoutMs: 8_000 });
    server.answers = false;

    server.close(4006);
    await vi.waitFor(() => expect(server.connections).toBe(2), { timeout: 2_000 });
    await wait(1_100);
    server.answers = true;
    server.close(4006);
    await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 2_000 });
    await settle();

    expect(channels(gateway)).toEqual([CHANNEL, null, CHANNEL, null, CHANNEL]);
    expect(events).toEqual([{ type: "connected", gateway: expect.any(Object) }]);
  });

  it("keeps the voice through a gateway that refuses payloads past the join timeout and then accepts them", async () => {
    const { server, gateway, connection, events } = await joined({ reconnectTimeoutMs: 8_000 });
    const answer = gateway.sendPayload.getMockImplementation();
    if (!answer) throw new Error("Expected the gateway fake to answer payloads");
    gateway.sendPayload.mockImplementation(() => false);

    server.close(4006);
    await wait(TIMEOUT_MS + 500);
    gateway.sendPayload.mockImplementation(answer);
    await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 3_000 });
    await settle();

    expect(channels(gateway).slice(-2)).toEqual([null, CHANNEL]);
    expect(events).toEqual([{ type: "connected", gateway: expect.any(Object) }]);
  });

  it("reports the failed recovery before its one disconnect at reconnectTimeoutMs when the gateway refuses every payload", async () => {
    const { server, gateway, timeline, reports } = await joined();
    gateway.sendPayload.mockImplementation(() => false);
    const closedAt = performance.now();

    server.close(4006);
    await vi.waitFor(() => expect(timeline).toContain("disconnected"), { timeout: 2 * RECONNECT_MS });
    const elapsed = performance.now() - closedAt;
    await settle();

    expect(elapsed).toBeGreaterThanOrEqual(RECONNECT_MS - 50);
    expect(timeline).toEqual(["voice.recovery.failed", "disconnected"]);
    expect(reports).toEqual([
      {
        severity: "error",
        stage: "voice.recovery.failed",
        message: expect.any(String),
        guildId: "guild",
        error: expect.any(Error),
        data: {
          durationMs: expect.any(Number),
          rounds: 0,
          closeCode: 4006,
          path: "library",
          trail: expect.stringContaining("close:4006"),
        },
      },
    ]);
  });

  it(
    "fails once with the round counted when the deadline passes before any round is answered",
    async () => {
      const { server, gateway, timeline, reports } = await joined({ reconnectTimeoutMs: 6_000 });
      server.answers = false;

      server.close(1001);
      await vi.waitFor(() => expect(timeline).toContain("disconnected"), { timeout: 8_000 });
      await settle();

      expect(timeline).toEqual(["voice.recovery.failed", "disconnected"]);
      expect(reports[0]?.data).toMatchObject({ rounds: 1, path: "rejoin" });
      expect(joins(gateway)).toHaveLength(2);
    },
    ROUND_TEST_MS,
  );

  it("reconnects on the restored server after the voice server endpoint is removed, and reports the server path", async () => {
    const { gateway, connection, events, reports } = await joined();

    gateway.server("token", null);
    await vi.waitFor(() => expect(connection.state.status).toBe("disconnected"));
    gateway.server("restored");
    await vi.waitFor(() => expect(connection.state.status).toBe("ready"), { timeout: 2_000 });
    await settle();

    expect(events).toEqual([{ type: "connected", gateway: expect.objectContaining({ token: "restored" }) }]);
    expect(recovered(reports).map(diagnostic => diagnostic.data)).toEqual([
      { durationMs: expect.any(Number), rounds: 0, path: "server", trail: expect.stringMatching(/ready$/) },
    ]);
  });

  it(
    "holds the track's position while the connection is not Ready",
    async () => {
      const { server, connection, player } = await playing(
        { kind: "file", path: media.steps },
        { reconnectTimeoutMs: 8_000 },
      );

      server.close(1001);
      await vi.waitFor(() => expect(connection.state.status).not.toBe("ready"));
      await wait(100);
      const before = player.position;
      await wait(2_000);

      expect(player.position - before).toBeLessThanOrEqual(0.02);
    },
    ROUND_TEST_MS,
  );
});
