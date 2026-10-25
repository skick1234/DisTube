import type { VoiceSession } from "distube/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine, DiscordVoiceSession } from "../src";
import { FilterRegistry } from "../src/engine";
import { CHANNEL, gatewayAdapter, latest, native, resetNative } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const OPTIONS = {
  guildId: "guild",
  channelId: CHANNEL,
  clientUserId: "bot",
  adapterCreator: gatewayAdapter().creator,
  selfDeaf: true,
  selfMute: false,
  timeoutMs: 50,
  channelBitrate: () => 64_000,
  preflight: () => undefined,
};
const SETTINGS = { opusComplexity: 10, bufferMs: 500 };
const PLAYER_OPTIONS = { onClosed: () => undefined };

beforeEach(resetNative);

describe("engine", () => {
  it("creates a Player over its own session's connection", async () => {
    const engine = new DiscordVoiceEngine(SETTINGS);
    const session = await DiscordVoiceSession.connect(OPTIONS);

    const player = await engine.createPlayer(session, PLAYER_OPTIONS);

    expect(latest.connection.subscribe).toHaveBeenCalledWith(latest.player);
    expect(player.position).toBe(0);
    await player.release();
    await session.release();
  });

  it("names node-av and its host requirement when the binding cannot load", async () => {
    const engine = new DiscordVoiceEngine(SETTINGS);
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const failure = new Error("libavcodec.so: cannot open shared object file");
    vi.doMock("node-av", () => {
      throw failure;
    });
    try {
      await expect(engine.createPlayer(session, PLAYER_OPTIONS)).rejects.toMatchObject({
        code: "VOICE_FAILED",
        message: expect.stringContaining("node-av native binding, which runs on glibc 2.28 or newer"),
      });
      expect(native.joinVoiceChannel).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("node-av");
      await session.release();
    }
  });

  it("refuses a session it does not own", async () => {
    const engine = new DiscordVoiceEngine(SETTINGS);
    const foreign = { guildId: "guild", channelId: CHANNEL } as unknown as VoiceSession;

    await expect(engine.createPlayer(foreign, PLAYER_OPTIONS)).rejects.toThrow(
      "only plays through its own package's VoiceSession",
    );
  });

  it("exposes its merged preset metadata", () => {
    const engine = new DiscordVoiceEngine({
      ...SETTINGS,
      filters: { house: { render: () => "volume=2", label: "House" } },
    });

    expect(engine.filters.get("bassboost")).toMatchObject({ default: 10, min: 0, max: 20, acceptsValue: true });
    expect(engine.filters.get("house")?.label()).toBe("House");
    expect(engine.filters.has("unknown")).toBe(false);
  });
});

describe("filter registry", () => {
  it("folds the ordered set into one libavfilter chain", () => {
    const registry = new FilterRegistry();

    expect(registry.render([])).toBeUndefined();
    expect(registry.render([{ name: "echo" }, { name: "karaoke" }])).toBe(
      "aecho=0.8:0.9:1000:0.3,stereotools=mlev=0.03",
    );
  });

  it("renders a ranged preset from the value core committed", () => {
    const registry = new FilterRegistry();

    expect(registry.render([{ name: "bassboost", value: 15 }])).toBe("bass=g=15");
    expect(registry.render([{ name: "nightcore", value: 1.5 }])).toBe("asetrate=48000*1.5,aresample=48000,bass=g=5");
  });

  it("overrides a built-in preset and adds new ones", () => {
    const registry = new FilterRegistry({
      echo: { render: () => "aecho=1" },
      house: { render: (value = 2) => `volume=${value}`, default: 2, min: 0, max: 5 },
    });

    expect(registry.render([{ name: "echo" }, { name: "house", value: 3 }])).toBe("aecho=1,volume=3");
  });

  it("describes every preset for command option building", () => {
    const registry = new FilterRegistry({
      house: { render: () => "volume=2", label: "House" },
      pulse: { render: v => `apulsator=hz=${v}`, min: 0, max: 5, label: v => `Pulse ${v}` },
    });

    expect(registry.definitions.get("bassboost")).toEqual({
      default: 10,
      min: 0,
      max: 20,
      acceptsValue: true,
      label: expect.any(Function),
    });
    expect(registry.definitions.get("bassboost")?.label(15)).toBe("Bass +15dB");
    expect(registry.definitions.get("bassboost")?.label()).toBe("Bass +10dB");
    expect(registry.definitions.get("nightcore")?.label(1.5)).toBe("Nightcore x1.5");
    // A fixed preset without a label is named after itself; a ranged one without a default labels the value given.
    expect(registry.definitions.get("echo")).toMatchObject({ acceptsValue: false });
    expect(registry.definitions.get("echo")?.label()).toBe("echo");
    expect(registry.definitions.get("house")?.label(4)).toBe("House");
    expect(registry.definitions.get("pulse")?.label(2)).toBe("Pulse 2");
  });

  it("rejects a name it cannot render and a definition it cannot use", () => {
    expect(() => new FilterRegistry().render([{ name: "unknown" }])).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED", message: "Filter unknown is not defined by this engine" }),
    );
    const broken: readonly [unknown, string][] = [
      ["volume=2", "must define a render function"],
      [{ render: () => "x", min: Number.NaN }, "min must be a finite number"],
      [{ render: () => "x", min: 5, max: 1 }, "min must not exceed max"],
      [{ render: () => "x", default: 9, max: 5 }, "default must lie within its range"],
      [{ render: () => "x", label: 7 }, "label must be a string or a function"],
    ];
    for (const [definition, message] of broken) {
      expect(() => new FilterRegistry({ broken: definition as never })).toThrow(
        new TypeError(`Filter broken ${message}`),
      );
    }
  });
});
