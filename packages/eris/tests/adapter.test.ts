import { FilterRegistry } from "@distube/voice-core/core";
import { DisTubeError } from "distube";
import type { FilterEntry, VoiceSession } from "distube/integrations";
import type { Client } from "eris";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErisAdapter } from "../src";
import { asClient, CHANNEL, FakeClient, GUILD, voiceChannel } from "./support/eris";

const { preflight, preflightFactory } = vi.hoisted(() => {
  const preflight = vi.fn(async (): Promise<void> => undefined);
  const preflightFactory = vi.fn((_owner: string) => preflight);
  return { preflight, preflightFactory };
});

vi.mock("../src/engine", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/engine")>();
  return { ...actual, erisPreflight: preflightFactory };
});

const TARGET = { guildId: GUILD, channelId: CHANNEL };

function adapter(client: FakeClient = new FakeClient(), options = {}): ErisAdapter {
  return new ErisAdapter(asClient(client), options);
}

beforeEach(() => {
  preflight.mockReset();
  preflight.mockResolvedValue(undefined);
  preflightFactory.mockClear();
});

describe("adapter", () => {
  it("requires a client and well-formed connection options", () => {
    expect(() => new ErisAdapter(undefined as unknown as Client)).toThrow("requires an Eris Client");
    expect(() => adapter(new FakeClient(), { connectionTimeoutMs: 0 })).toThrow(
      "connectionTimeoutMs must be a positive integer",
    );
    expect(() => adapter(new FakeClient(), { selfDeaf: "yes" })).toThrow("selfDeaf must be boolean");
    expect(() => adapter(new FakeClient(), { selfMute: "no" })).toThrow("selfMute must be boolean");
  });

  it("validates the target channel before joining voice", async () => {
    const client = new FakeClient();
    client.channels.set("foreign", voiceChannel("other-guild"));

    await expect(adapter(client).createVoiceSession({ ...TARGET, channelId: "missing" })).rejects.toThrow(
      "Eris voice channel is unavailable: missing",
    );
    await expect(adapter(client).createVoiceSession({ ...TARGET, channelId: "foreign" })).rejects.toThrow(
      `does not belong to guild ${GUILD}`,
    );
    expect(client.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("runs prerequisite preflight before creating a native voice connection", async () => {
    const client = new FakeClient();
    const failure = new DisTubeError("VOICE_FAILED", "@distube/eris requires tweetnacl");
    preflight.mockRejectedValueOnce(failure);

    await expect(adapter(client).createVoiceSession(TARGET)).rejects.toBe(failure);
    expect(client.joinVoiceChannel).not.toHaveBeenCalled();
  });

  it("connects a session with the presence options it was configured with", async () => {
    const client = new FakeClient();

    const session = await adapter(client, { selfDeaf: false, selfMute: true }).createVoiceSession(TARGET);

    expect(client.joinVoiceChannel).toHaveBeenCalledWith(CHANNEL, { selfDeaf: false, selfMute: true });
    expect(session.guildId).toBe(GUILD);
    expect(session.clientUserId).toBe(client.user.id);
    expect(session.channelId).toBe(CHANNEL);
  });
});

describe("engine", () => {
  it("plays through its own package's session only", async () => {
    const client = new FakeClient();
    const instance = adapter(client);
    const session = await instance.createVoiceSession(TARGET);

    const player = await instance.engine.createPlayer(session);
    // Nothing is playing, so ending a track is a no-op rather than an error.
    await expect(player.stopTrack()).resolves.toBeUndefined();

    await expect(instance.engine.createPlayer({ guildId: GUILD } as unknown as VoiceSession)).rejects.toThrow(
      "only plays through its own package's VoiceSession",
    );
  });

  it("resolves its built-in filters alongside the presets it was configured with", () => {
    const instance = adapter(new FakeClient(), { filters: { house: "volume=2" } });

    expect(instance.engine.resolvable("nightcore")).toBe(true);
    expect(instance.engine.resolvable("house")).toBe(true);
    expect(instance.engine.resolvable("unknown")).toBe(false);
  });
});

describe("filter registry", () => {
  const render = (entries: readonly FilterEntry[], definitions = {}): string | undefined =>
    new FilterRegistry(definitions).render(entries);

  it("folds the ordered set into one chain, calculating what takes a value", () => {
    expect(render([])).toBeUndefined();
    expect(render([{ name: "echo" }, { name: "karaoke" }])).toBe("aecho=0.8:0.9:1000:0.3,stereotools=mlev=0.03");
    expect(render([{ name: "bassboost", value: 20 }])).toBe("bass=g=20");
    expect(render([{ name: "bassboost" }])).toBe("bass=g=10");
  });

  it("takes construction-time definitions over the built-in ones", () => {
    expect(render([{ name: "echo" }, { name: "house" }], { echo: "aecho=1", house: "volume=2" })).toBe(
      "aecho=1,volume=2",
    );
    expect(() => new FilterRegistry({ broken: 7 as unknown as string })).toThrow(TypeError);
  });

  it("takes an ad hoc payload as written and refuses an empty one", () => {
    expect(render([{ name: "adhoc", payload: "  volume=3  " }])).toBe("volume=3");
    expect(() => render([{ name: "adhoc", payload: "   " }])).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });

  it("refuses a name it does not define", () => {
    expect(() => render([{ name: "unknown" }])).toThrow(
      expect.objectContaining({
        code: "UNSUPPORTED",
        message: "Filter unknown is not defined by this engine",
      }),
    );
  });
});
