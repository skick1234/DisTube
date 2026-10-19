import type { VoiceSession } from "distube/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErisVoiceEngine } from "../src/engine";
import { ErisVoiceSession } from "../src/session";
import { asClient, CHANNEL, FakeClient, GATEWAY, GUILD } from "./support/eris";

interface CapturedTransport {
  readonly credentials: unknown[];
  readonly disconnects: number;
}

const captured = vi.hoisted(() => ({ transports: [] as CapturedTransport[], autoReady: true }));

vi.mock("eris", async () => {
  const actual = await vi.importActual<typeof import("eris")>("eris");
  const { EventEmitter } = await import("node:events");
  class Transport extends EventEmitter {
    readonly credentials: unknown[] = [];
    disconnects = 0;
    ready = false;
    channelID: string | null = null;
    current = undefined;
    updateVoiceState = vi.fn();
    stopPlaying = vi.fn();
    connect(data: { channel_id: string }): void {
      this.credentials.push(data);
      this.channelID = data.channel_id;
      if (captured.autoReady)
        queueMicrotask(() => {
          this.ready = true;
          this.emit("ready");
        });
    }
    disconnect(): void {
      this.disconnects++;
      this.ready = false;
      this.channelID = null;
      this.updateVoiceState();
      this.emit("disconnect");
    }
    constructor() {
      super();
      captured.transports.push(this);
    }
  }
  return { ...actual, VoiceConnection: Transport };
});

beforeEach(() => {
  captured.transports.length = 0;
  captured.autoReady = true;
});

describe("Eris local transport", () => {
  it("rejects a foreign session before probing local dependencies", async () => {
    const preflight = vi.fn(async () => undefined);
    const engine = new ErisVoiceEngine(undefined, preflight);

    await expect(engine.createPlayer({ guildId: GUILD } as VoiceSession)).rejects.toThrow("own package's VoiceSession");
    expect(preflight).not.toHaveBeenCalled();
    expect(captured.transports).toHaveLength(0);
  });

  it("replays a live snapshot to each replacement Player and leaves only through the session", async () => {
    const client = new FakeClient();
    const session = await ErisVoiceSession.connect({
      client: asClient(client),
      guildId: GUILD,
      channelId: CHANNEL,
      clientUserId: "bot",
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: 50,
    });
    const engine = new ErisVoiceEngine(undefined, async () => undefined);
    const sent = client.sendWS.mock.calls.length;

    const first = await engine.createPlayer(session);
    expect(captured.transports[0]?.credentials).toEqual([
      {
        channel_id: CHANNEL,
        session_id: GATEWAY.sessionId,
        endpoint: GATEWAY.endpoint,
        token: GATEWAY.token,
        user_id: "bot",
      },
    ]);
    await first.release();
    expect(captured.transports[0]?.disconnects).toBe(1);
    expect(session.gateway).toEqual(GATEWAY);
    expect(client.sendWS).toHaveBeenCalledTimes(sent);

    const second = await engine.createPlayer(session);
    expect(captured.transports).toHaveLength(2);
    expect(captured.transports[1]?.credentials).toEqual(captured.transports[0]?.credentials);
    await second.release();
    await session.release();
    expect(client.sendWS.mock.calls.filter(([, payload]) => payload.channel_id === null)).toHaveLength(1);
    expect(captured.transports.map(transport => transport.disconnects)).toEqual([1, 1]);
  });

  it("cancels transport readiness when its session leaves", async () => {
    const client = new FakeClient();
    const session = await ErisVoiceSession.connect({
      client: asClient(client),
      guildId: GUILD,
      channelId: CHANNEL,
      clientUserId: "bot",
      selfDeaf: true,
      selfMute: false,
      connectionTimeoutMs: 50,
    });
    captured.autoReady = false;
    const creating = new ErisVoiceEngine(undefined, async () => undefined).createPlayer(session);
    await Promise.resolve();
    await session.release();

    await expect(creating).rejects.toThrow("disconnected before it became ready");
    expect(captured.transports[0]?.disconnects).toBe(1);
    expect(client.sendWS.mock.calls.filter(([, payload]) => payload.channel_id === null)).toHaveLength(1);
  });
});
