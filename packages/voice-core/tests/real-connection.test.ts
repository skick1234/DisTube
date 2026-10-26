import { getVoiceConnection, type VoiceConnection } from "@discordjs/voice";
import type { VoiceSessionEvent } from "distube/integrations";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { CHANNEL, gatewayAdapter, settle } from "./support/native";
import { serveAudio, serveVoiceGateway, type VoiceGatewayServer } from "./support/real";

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
    const engine = new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500 });
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
