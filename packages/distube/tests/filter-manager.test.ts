import { describe, expect, it } from "vitest";
import { type FakePlayer, GUILD, playableSetup, required, settle, VOICE_CHANNEL } from "./support/harness";

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

    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass +15dB" }]);
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
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 10, label: "Bass +10dB" }]);
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
      { name: "bassboost", value: 5, label: "Bass +5dB" },
      { name: "nightcore", label: "Nightcore" },
    ]);
    expect(player.renders.at(-1)).toEqual([{ name: "bassboost", value: 5 }, { name: "nightcore" }]);
  });

  it("toggles a preset on and off, and removes or clears selected presets", async () => {
    const { voice, player } = await playingVoice();

    await voice.filters.toggle("bassboost", 3);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 3, label: "Bass +3dB" }]);
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

  it("exposes preset definitions for command option building", async () => {
    const { voice } = await playingVoice();

    const bassboost = required(voice.filters.definitions.get("bassboost"));
    const nightcore = required(voice.filters.definitions.get("nightcore"));

    expect(bassboost).toMatchObject({ acceptsValue: true, default: 10, min: 0, max: 20 });
    expect(bassboost.label(7)).toBe("Bass +7dB");
    expect(nightcore).toMatchObject({ acceptsValue: false });
    expect(nightcore.default).toBeUndefined();
    expect(nightcore.label()).toBe("Nightcore");
    expect(required(voice.filters.definitions.get("echo")).label()).toBe("echo");
    expect(voice.filters.definitions.has("reverb")).toBe(false);
  });

  it("pushes filters and volume committed before any Player onto the first Player once, before its first play", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);

    await voice.filters.set("bassboost", 12);
    await voice.setVolume(20);
    expect(harness.engine.createPlayer).not.toHaveBeenCalled();
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 12, label: "Bass +12dB" }]);

    const queue = await harness.distube.play(channel, "a");
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
    const queue = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]) as FakePlayer;
    await voice.filters.set("bassboost", 15);

    await queue.stop();
    expect(player.renders).toEqual([[{ name: "bassboost", value: 15 }]]);
    const next = await harness.distube.play(channel, "b");
    await settle();
    expect(next).not.toBe(queue);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(voice.filters.entries).toEqual([{ name: "bassboost", value: 15, label: "Bass +15dB" }]);

    await harness.distube.voices.leave(GUILD);
    await expect(voice.filters.set("nightcore")).rejects.toMatchObject({ code: "INVALID_STATE" });
    const fresh = await harness.distube.voices.join(channel);
    expect(fresh).not.toBe(voice);
    expect(fresh.filters.names).toEqual([]);
    expect(fresh.volume).toBe(100);
  });
});
