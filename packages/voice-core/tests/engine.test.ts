import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import type { VoiceSession } from "distube/integrations";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine, DiscordVoiceSession } from "../src/discord";
import { FilterRegistry } from "../src/filters";
import { CHANNEL, latest, resetNative } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const OPTIONS = {
  guildId: "guild",
  channelId: CHANNEL,
  clientUserId: "bot",
  adapterCreator: (() => ({})) as unknown as DiscordGatewayAdapterCreator,
  selfDeaf: true,
  selfMute: false,
  connectionTimeoutMs: 50,
};

beforeEach(resetNative);

describe("engine", () => {
  it("declares url as the only kind its Players accept, and its Players agree", async () => {
    const engine = new DiscordVoiceEngine();
    const session = await DiscordVoiceSession.connect(OPTIONS);
    const player = await engine.createPlayer(session);

    expect([...engine.accepts]).toEqual(["url"]);

    // The declaration is only worth something if the Player enforces it.
    const encoded = { itemId: "item", resource: { kind: "encoded", encoded: "track", dispose: vi.fn() } };
    await expect(player.play(encoded as never)).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  it("creates a Player over its own session's connection", async () => {
    const engine = new DiscordVoiceEngine();
    const session = await DiscordVoiceSession.connect(OPTIONS);

    const player = await engine.createPlayer(session);

    expect(latest.connection.subscribe).toHaveBeenCalledWith(latest.player);
    expect(player.position).toBe(0);
  });

  it("refuses a session it does not own", async () => {
    const engine = new DiscordVoiceEngine();
    const foreign = { guildId: "guild", channelId: CHANNEL } as unknown as VoiceSession;

    await expect(engine.createPlayer(foreign)).rejects.toThrow("only plays through its own package's VoiceSession");
  });

  it("resolves the names its registry defines", () => {
    const engine = new DiscordVoiceEngine({ house: "volume=2" });

    expect(engine.resolvable("nightcore")).toBe(true);
    expect(engine.resolvable("house")).toBe(true);
    expect(engine.resolvable("unknown")).toBe(false);
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

  it("renders a calculated preset from its value, falling back to the preset default", () => {
    const registry = new FilterRegistry();

    expect(registry.render([{ name: "bassboost", value: 20 }])).toBe("bass=g=20");
    expect(registry.render([{ name: "bassboost" }])).toBe("bass=g=10");
  });

  it("overrides a built-in preset and adds new ones", () => {
    const registry = new FilterRegistry({ echo: "aecho=1", house: (value = 2) => `volume=${value}` });

    expect(registry.render([{ name: "echo" }, { name: "house", value: 3 }])).toBe("aecho=1,volume=3");
  });

  it("renders an ad hoc payload as written, without a definition", () => {
    const registry = new FilterRegistry();

    expect(registry.render([{ name: "adhoc", payload: " volume=2 " }])).toBe("volume=2");
    expect(() => registry.render([{ name: "adhoc", payload: " " }])).toThrowError(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
  });

  it("rejects a name it cannot render and a definition it cannot use", () => {
    expect(() => new FilterRegistry({ broken: 1 as unknown as string })).toThrow(TypeError);
    expect(() => new FilterRegistry().render([{ name: "unknown" }])).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED", message: "Filter unknown is not defined by this engine" }),
    );
  });
});
