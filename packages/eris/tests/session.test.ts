import type { VoiceSessionEvent } from "distube/integrations";
import type { VoiceChannel } from "eris";
import { describe, expect, it, vi } from "vitest";
import { ErisAdapter } from "../src/adapter";
import { ErisVoiceSession } from "../src/session";
import {
  announceServer,
  announceState,
  asClient,
  CHANNEL,
  FakeClient,
  GATEWAY,
  GUILD,
  settle,
  voiceChannel,
} from "./support/eris";

const OPTIONS = {
  guildId: GUILD,
  channelId: CHANNEL,
  clientUserId: "bot",
  selfDeaf: true,
  selfMute: false,
  connectionTimeoutMs: 50,
} as const;

function connect(client: FakeClient): Promise<ErisVoiceSession> {
  return ErisVoiceSession.connect({ client: asClient(client), ...OPTIONS });
}

describe("Eris gateway session", () => {
  it("joins over the gateway without constructing an audio connection", async () => {
    const client = new FakeClient();
    const session = await connect(client);

    expect(client.joinVoiceChannel).not.toHaveBeenCalled();
    expect(client.sendWS).toHaveBeenCalledExactlyOnceWith(4, {
      guild_id: GUILD,
      channel_id: CHANNEL,
      self_deaf: true,
      self_mute: false,
    });
    expect(session.gateway).toEqual(GATEWAY);
    expect(Object.isFrozen(session.gateway)).toBe(true);
    await session.release();
  });

  it("passes its configured filter presets to its engine", () => {
    const adapter = new ErisAdapter(asClient(new FakeClient()), {
      filters: { house: { render: () => "volume=2", label: "House" } },
    });
    expect(adapter.engine.filters.get("house")?.label()).toBe("House");
  });

  it("rejects invalid adapter construction and conflicting native identity before gateway work", () => {
    const client = new FakeClient();
    expect(() => new ErisAdapter(undefined as unknown as ReturnType<typeof asClient>)).toThrow(
      "requires an Eris Client",
    );
    expect(() => new ErisAdapter(asClient(client), { connectionTimeoutMs: 0 })).toThrow("positive integer");
    const adapter = new ErisAdapter(asClient(client));
    const target = { id: CHANNEL, guildID: "other", guild: { id: GUILD } } as unknown as VoiceChannel;

    expect(() => adapter.normalizeTarget(target)).toThrow("conflicting guild identities");
    expect(client.getChannel).not.toHaveBeenCalled();
    expect(client.sendWS).not.toHaveBeenCalled();
  });

  it("rejects a missing bot identity before gateway work", async () => {
    const client = new FakeClient();
    Object.defineProperty(client, "user", { value: undefined });
    const adapter = new ErisAdapter(asClient(client));

    await expect(adapter.createVoiceSession({ guildId: GUILD, channelId: CHANNEL })).rejects.toThrow(
      "Eris client user is unavailable",
    );
    expect(client.sendWS).not.toHaveBeenCalled();
  });

  it("refuses a missing, nonvoice or foreign channel before gateway mutation", async () => {
    const client = new FakeClient();
    client.channels.set("text", { type: 0, guild: { id: GUILD } });
    client.channels.set("foreign", voiceChannel("foreign-guild"));
    const session = await connect(client);
    const sends = client.sendWS.mock.calls.length;

    for (const channel of ["missing", "text", "foreign"]) {
      await expect(session.join(channel)).rejects.toThrow("Invalid Eris voice channel");
    }
    expect(client.sendWS).toHaveBeenCalledTimes(sends);
    await session.release();
  });

  it("moves and updates self state through the same gateway authority", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const session = await connect(client);
    const events: VoiceSessionEvent[] = [];
    session.subscribe(event => events.push(event));

    await session.setSelfMute(true);
    await session.join("other", { selfDeaf: false });

    expect(client.sendWS).toHaveBeenLastCalledWith(4, {
      guild_id: GUILD,
      channel_id: "other",
      self_deaf: false,
      self_mute: true,
    });
    expect(session.gateway).toEqual({ ...GATEWAY, channelId: "other" });
    expect(session.selfMute).toBe(true);
    expect(session.selfDeaf).toBe(false);
    expect(events.at(-1)).toEqual({ type: "connected", channelId: "other", gateway: session.gateway });
    await session.release();
  });

  it("waits for new server credentials after an external channel move", async () => {
    const client = new FakeClient();
    const session = await connect(client);
    const events: VoiceSessionEvent[] = [];
    session.subscribe(event => events.push(event));

    announceState(client, { ...GATEWAY, sessionId: "new-session" }, GUILD, "dragged");
    expect(session.gateway).toBeUndefined();
    announceServer(client, { ...GATEWAY, token: "new-token", endpoint: "new.example" });

    expect(session.gateway).toEqual({
      channelId: "dragged",
      sessionId: "new-session",
      token: "new-token",
      endpoint: "new.example",
    });
    expect(events).toEqual([{ type: "connected", channelId: "dragged", gateway: session.gateway }]);
    await session.release();
  });

  it("retains the committed snapshot when outbound movement is refused", async () => {
    const client = new FakeClient();
    client.channels.set("other", voiceChannel());
    const session = await connect(client);
    client.sendWS.mockImplementationOnce(() => {
      throw new Error("gateway unavailable");
    });

    await expect(session.join("other")).rejects.toThrow("gateway unavailable");
    expect(session.gateway).toEqual(GATEWAY);
    expect(session.channelId).toBe(CHANNEL);
    await session.release();
  });

  it("reports external removal once and isolates subscribers", async () => {
    const client = new FakeClient();
    const session = await connect(client);
    session.subscribe(() => {
      throw new Error("listener failed");
    });
    const received = vi.fn();
    session.subscribe(received);

    announceState(client, GATEWAY, GUILD, null);
    await settle();
    announceState(client, GATEWAY, GUILD, null);

    expect(received).toHaveBeenCalledExactlyOnceWith({ type: "disconnected", error: expect.any(Error) });
    expect(session.gateway).toBeUndefined();
  });

  it("releases gateway membership once across concurrent callers", async () => {
    const client = new FakeClient();
    const session = await connect(client);

    const first = session.release();
    expect(session.release()).toBe(first);
    await first;
    expect(client.sendWS.mock.calls.filter(([, payload]) => payload.channel_id === null)).toHaveLength(1);
    await expect(session.join(CHANNEL)).rejects.toThrow("released");
  });
});
