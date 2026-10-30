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
const SETTINGS = { opusComplexity: 10, bufferMs: 500, report: () => undefined };
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
    expect(engine.filters.get("house")?.label).toBe("House");
    expect(engine.filters.has("unknown")).toBe(false);
  });

  it.each([
    [[{ name: "nightcore", value: 1.5 }], 1.5],
    [
      [
        { name: "nightcore", value: 1.25 },
        { name: "vaporwave", value: 0.8 },
      ],
      1,
    ],
    [[{ name: "bassboost", value: 15 }], 1],
    [[], 1],
  ])("plays the selection %j at the product of its presets' tempos, %d", (entries, rate) => {
    expect(new DiscordVoiceEngine(SETTINGS).playbackRate(entries)).toBe(rate);
  });

  it("rejects a selection whose tempo function returns 0 with INVALID_ARGUMENT", () => {
    const engine = new DiscordVoiceEngine({
      ...SETTINGS,
      filters: { stall: { render: () => "volume=1", default: 1, min: 0, max: 2, tempo: value => value ?? 1 } },
    });

    expect(() => engine.playbackRate([{ name: "stall", value: 0 }])).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT", message: expect.stringContaining("stall") }),
    );
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

  it("describes every preset with a label that carries no value, or its name without one", () => {
    const registry = new FilterRegistry({ house: { render: () => "volume=2", label: "House" } });

    expect(registry.definitions.get("bassboost")).toEqual({
      default: 10,
      min: 0,
      max: 20,
      acceptsValue: true,
      label: "Bass boost",
    });
    expect(registry.definitions.get("nightcore")).toMatchObject({ default: 1.25, label: "Nightcore" });
    expect(registry.definitions.get("vaporwave")).toMatchObject({ default: 0.8, label: "Vaporwave" });
    expect(registry.definitions.get("echo")).toMatchObject({ acceptsValue: false, label: "echo" });
    expect(registry.definitions.get("house")?.label).toBe("House");
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
      [{ render: () => "x", label: 7 }, "label must be a string"],
      [{ render: () => "x", label: () => "House" }, "label must be a string"],
      [{ render: () => "x", tempo: 0 }, "tempo must be a function or a finite number above 0"],
      [{ render: () => "x", tempo: Number.POSITIVE_INFINITY }, "tempo must be a function or a finite number above 0"],
      [{ render: () => "x", tempo: "fast" }, "tempo must be a function or a finite number above 0"],
    ];
    for (const [definition, message] of broken) {
      expect(() => new FilterRegistry({ broken: definition as never })).toThrow(
        new TypeError(`Filter broken ${message}`),
      );
    }
  });
});
