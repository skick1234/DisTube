import { describe, expect, it, vi } from "vitest";
import { DisTubeError, type Song } from "../src";
import type { FilterEntry } from "../src/integrations";
import {
  capture,
  deferred,
  FakeEngine,
  type FakePlayer,
  GUILD,
  media,
  playableSetup,
  required,
  settle,
  updates,
  VOICE_CHANNEL,
} from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

/** A connected voice whose Player already exists, so every mutation renders through the backend. */
async function playingVoice() {
  const harness = playableSetup();
  await harness.distube.play(channel, "a");
  await settle();
  const voice = required(harness.distube.voices.get(GUILD));
  const player = required(harness.engine.players[0]) as FakePlayer;
  return { harness, voice, player };
}

describe("voice filter manager", () => {
  it("sets a ranged preset with a value, rendering one update with a labelled entry", async () => {
    const { voice, player } = await playingVoice();

    await voice.filters.set("bassboost", 15);

    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass boost" }]);
    expect(player.renders).toEqual([[{ name: "bassboost", value: 15 }]]);
    expect(voice.filters.has("bassboost")).toBe(true);
    expect(voice.filters.names).toEqual(["bassboost"]);
  });

  it("clamps a value to the preset range and uses the default when omitted", async () => {
    const { voice, player } = await playingVoice();

    await voice.filters.set("bassboost", 50);
    expect(voice.filters.entries[0]?.value).toBe(20);
    await voice.filters.set("bassboost", -3);
    expect(voice.filters.entries[0]?.value).toBe(0);
    await voice.filters.set("bassboost");
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 10, label: "Bass boost" }]);
    expect(player.renders.map(render => render[0]?.value)).toEqual([20, 0, 10]);
  });

  it("rejects a value on a fixed preset with INVALID_ARGUMENT and sends no backend update", async () => {
    const { voice, player } = await playingVoice();

    await expect(voice.filters.set("nightcore", 2)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(voice.filters.set("bassboost", Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });

    expect(player.renders).toEqual([]);
    expect(voice.filters.names).toEqual([]);
  });

  it("rejects an unknown preset with UNSUPPORTED and leaves the committed set unchanged", async () => {
    const { voice, player } = await playingVoice();
    await voice.filters.set("nightcore");

    await expect(voice.filters.set("reverb")).rejects.toMatchObject({ code: "UNSUPPORTED" });
    await expect(voice.filters.toggle("reverb")).rejects.toMatchObject({ code: "UNSUPPORTED" });

    expect(voice.filters.names).toEqual(["nightcore"]);
    expect(player.renders).toHaveLength(1);
  });

  it("replaces a selected preset in place, preserving order", async () => {
    const { voice, player } = await playingVoice();
    await voice.filters.set("bassboost");
    await voice.filters.set("nightcore");

    await voice.filters.set("bassboost", 5);

    expect(voice.filters.entries).toEqual([
      { name: "bassboost", value: 5, label: "Bass boost" },
      { name: "nightcore", label: "Nightcore" },
    ]);
    expect(player.renders.at(-1)).toEqual([{ name: "bassboost", value: 5 }, { name: "nightcore" }]);
  });

  it("toggles a preset on and off, and removes or clears selected presets", async () => {
    const { voice, player } = await playingVoice();

    await voice.filters.toggle("bassboost", 3);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 3, label: "Bass boost" }]);
    await voice.filters.toggle("bassboost");
    expect(voice.filters.names).toEqual([]);

    await voice.filters.set("echo");
    await voice.filters.set("nightcore");
    await voice.filters.remove("echo");
    expect(voice.filters.names).toEqual(["nightcore"]);
    await voice.filters.remove("missing");
    expect(voice.filters.names).toEqual(["nightcore"]);
    await voice.filters.clear();
    expect(voice.filters.names).toEqual([]);
    expect(voice.filters.has("nightcore")).toBe(false);
    expect(player.renders.at(-1)).toEqual([]);
  });

  it("keeps the previous set when the Player rejects a render and rejects with the backend failure", async () => {
    const { voice, player } = await playingVoice();
    await voice.filters.set("bassboost");
    const failure = new Error("render failed");
    player.setFilters.mockRejectedValueOnce(failure);

    await expect(voice.filters.set("nightcore")).rejects.toMatchObject({ code: "VOICE_FAILED", cause: failure });

    expect(voice.filters.names).toEqual(["bassboost"]);
    expect(player.renders).toEqual([[{ name: "bassboost", value: 10 }]]);
  });

  it("pushes filters and volume committed before any Player onto the first Player once, before its first play", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);

    await voice.filters.set("bassboost", 12);
    await voice.setVolume(20);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 12, label: "Bass boost" }]);

    const { queue } = await harness.distube.play(channel, "a");
    await queue.add("b");
    await settle();
    harness.engine.player.finish();
    await settle();
    const player = required(harness.engine.players[0]) as FakePlayer;
    expect(player.played).toEqual(["a", "b"]);

    expect(player.renders).toEqual([[{ name: "bassboost", value: 12 }]]);
    expect(player.calls.slice(0, 3)).toEqual(["volume:20", "filters", expect.stringMatching(/^play:/)]);
    expect(player.calls.filter(call => call === "filters")).toHaveLength(1);
  });

  it("persists across queue deletion without a clearing render and disappears with the voice", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]) as FakePlayer;
    await voice.filters.set("bassboost", 15);

    await queue.stop();
    expect(player.renders).toEqual([[{ name: "bassboost", value: 15 }]]);
    const { queue: next } = await harness.distube.play(channel, "b");
    await settle();
    expect(next).not.toBe(queue);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass boost" }]);

    await harness.distube.voices.leave(GUILD);
    await expect(voice.filters.set("nightcore")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const fresh = await harness.distube.voices.join(channel);
    expect(fresh).not.toBe(voice);
    expect(fresh.filters.names).toEqual([]);
    expect(fresh.volume).toBe(100);
  });
});

describe("client filter catalog", () => {
  it("describes every engine preset with a plain label before any voice exists", () => {
    const { distube } = playableSetup();

    expect(distube.voices.size).toBe(0);
    expect(distube.filters.get("bassboost")).toEqual({
      default: 10,
      min: 0,
      max: 20,
      acceptsValue: true,
      label: "Bass boost",
    });
    expect(distube.filters.get("karaoke")).toEqual({ acceptsValue: false, label: "karaoke" });
    expect(distube.filters.has("reverb")).toBe(false);
  });
});

const RATED_FILTERS = {
  fast: { render: () => "fast" },
  slow: { render: () => "slow" },
  stall: { render: () => "stall" },
};

class RatedEngine extends FakeEngine {
  readonly playbackRate = vi.fn((_entries: readonly FilterEntry[]): number => 1);

  constructor() {
    super(RATED_FILTERS);
  }
}

async function ratedQueue() {
  const engine = new RatedEngine();
  const harness = playableSetup("source", { engine });
  await harness.distube.play(channel, "a");
  await settle();
  return {
    harness,
    engine,
    queue: required(harness.distube.getQueue(GUILD)),
    voice: required(harness.distube.voices.get(GUILD)),
    player: engine.player,
  };
}

describe("playback rate", () => {
  it("stores the rate the engine reports for the next selection, asked before the Player command, and publishes it", async () => {
    const { harness, engine, queue, voice, player } = await ratedQueue();
    const rates: Record<string, number> = { fast: 1.5, "fast slow": 0.8 };
    engine.playbackRate.mockImplementation(entries => rates[entries.map(entry => entry.name).join(" ")] ?? 1);
    const published = updates(harness.distube);

    await voice.filters.set("fast");
    await voice.filters.set("slow");
    await settle();

    expect(engine.playbackRate.mock.calls).toEqual([[[{ name: "fast" }]], [[{ name: "fast" }, { name: "slow" }]]]);
    expect(engine.playbackRate.mock.invocationCallOrder[0]).toBeLessThan(
      required(player.setFilters.mock.invocationCallOrder[0]),
    );
    expect(queue.playbackRate).toBe(0.8);
    expect(published.map(event => event.playbackRate)).toEqual([1.5, 0.8]);
    await harness.distube.dispose();
  });

  it("reads 1 for a queue without a voice and for an engine without a rate", async () => {
    const harness = playableSetup();
    const held = deferred<readonly Song[]>();
    harness.source.search.mockReturnValueOnce(held.promise);
    const started = harness.distube.play(channel, "a");
    const queue = required(harness.distube.getQueue(GUILD));
    expect(queue.playbackRate).toBe(1);

    held.resolve([media("source", "a")]);
    await started;
    await settle();
    await required(harness.distube.voices.get(GUILD)).filters.set("nightcore");

    expect(queue.playbackRate).toBe(1);
    await harness.distube.dispose();
  });

  const refusal = new Error("tempo out of range");
  it.each([
    ["returns 0", (): number => 0, "INVALID_ARGUMENT", undefined],
    ["returns NaN", (): number => Number.NaN, "INVALID_ARGUMENT", undefined],
    [
      "throws a plain Error",
      (): number => {
        throw refusal;
      },
      "INVALID_ARGUMENT",
      refusal,
    ],
    [
      "throws a DisTubeError",
      (): number => {
        throw new DisTubeError("UNSUPPORTED", "no such tempo");
      },
      "UNSUPPORTED",
      undefined,
    ],
  ] as const)(
    "rejects a filter change whose rate the engine %s, without a Player command",
    async (_case, rate, code, cause) => {
      const { harness, engine, queue, voice, player } = await ratedQueue();
      engine.playbackRate.mockImplementation(entries => (entries.some(entry => entry.name === "fast") ? 1.5 : 1));
      await voice.filters.set("fast");
      engine.playbackRate.mockImplementationOnce(rate);

      const failure = (await capture(voice.filters.set("stall"))) as DisTubeError;

      expect([failure.code, failure.cause]).toEqual([code, cause]);
      expect(player.renders).toEqual([[{ name: "fast" }]]);
      expect(voice.filters.names).toEqual(["fast"]);
      expect(queue.playbackRate).toBe(1.5);
      await harness.distube.dispose();
    },
  );
});
