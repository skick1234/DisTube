import type { VoiceSession } from "distube/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine, DiscordVoiceSession } from "../src/discord";
import { FilterRegistry } from "../src/filters";
import { CHANNEL, gatewayAdapter, latest, resetNative } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const OPTIONS = {
  guildId: "guild",
  channelId: CHANNEL,
  clientUserId: "bot",
  adapterCreator: gatewayAdapter().creator,
  selfDeaf: true,
  selfMute: false,
  connectionTimeoutMs: 50,
};

beforeEach(resetNative);

describe("engine", () => {
  it("declares each local input kind and rejects encoded tracks", async () => {
    const engine = new DiscordVoiceEngine(undefined, async () => undefined);
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const player = await engine.createPlayer(session);

    expect([...engine.accepts]).toEqual(["url", "file", "stream"]);

    // The declaration is only worth something if the Player enforces it.
    const encoded = { itemId: "item", resource: { kind: "encoded", encoded: "track", dispose: vi.fn() } };
    await expect(player.play(encoded as never)).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await player.release();
    await session.release();
  });

  it("creates a Player over its own session's connection", async () => {
    const engine = new DiscordVoiceEngine(undefined, async () => undefined);
    const session = await DiscordVoiceSession.connect(OPTIONS);

    const player = await engine.createPlayer(session);

    expect(latest.connection.subscribe).toHaveBeenCalledWith(latest.player);
    expect(player.position).toBe(0);
    await player.release();
    await session.release();
  });

  it("refuses a session it does not own", async () => {
    const engine = new DiscordVoiceEngine(undefined, async () => undefined);
    const foreign = { guildId: "guild", channelId: CHANNEL } as unknown as VoiceSession;

    await expect(engine.createPlayer(foreign)).rejects.toThrow("only plays through its own package's VoiceSession");
  });

  it("exposes its merged preset metadata and local seek support", () => {
    const engine = new DiscordVoiceEngine({ house: { render: () => "volume=2", label: "House" } });

    expect(engine.capabilities).toEqual({ seek: true });
    expect(engine.filters.get("bassboost")).toMatchObject({ default: 10, min: 0, max: 20, acceptsValue: true });
    expect(engine.filters.get("house")?.label()).toBe("House");
    expect(engine.filters.has("unknown")).toBe(false);
  });
});

describe("filter registry", () => {
  it("folds the ordered set into one ffmpeg chain", () => {
    const registry = new FilterRegistry();

    expect(registry.render([])).toBeUndefined();
    expect(registry.render([{ name: "echo" }, { name: "karaoke" }])).toBe(
      "aecho=0.8:0.9:1000:0.3,stereotools=mlev=0.03",
    );
  });

  it("renders a ranged preset from its value, defaulting and clamping to the declared range", () => {
    const registry = new FilterRegistry();

    expect(registry.render([{ name: "bassboost", value: 15 }])).toBe("bass=g=15");
    expect(registry.render([{ name: "bassboost" }])).toBe("bass=g=10");
    expect(registry.render([{ name: "bassboost", value: 50 }])).toBe("bass=g=20");
    expect(registry.render([{ name: "nightcore", value: 1.5 }])).toBe("asetrate=48000*1.5,aresample=48000,bass=g=5");
    expect(registry.render([{ name: "vaporwave", value: 0.1 }])).toBe("asetrate=48000*0.5,aresample=48000,bass=g=5");
  });

  it("refuses a value on a fixed preset and a value that is not a finite number", () => {
    const registry = new FilterRegistry();

    expect(() => registry.render([{ name: "echo", value: 2 }])).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT", message: "Filter echo does not take a value" }),
    );
    expect(() => registry.render([{ name: "bassboost", value: Number.NaN }])).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });

  it("overrides a built-in preset and adds new ones", () => {
    const registry = new FilterRegistry({
      echo: { render: () => "aecho=1" },
      house: { render: (value = 2) => `volume=${value}`, default: 2, min: 0, max: 5 },
    });

    expect(registry.render([{ name: "echo" }, { name: "house", value: 3 }])).toBe("aecho=1,volume=3");
    expect(registry.render([{ name: "house", value: 9 }])).toBe("volume=5");
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
