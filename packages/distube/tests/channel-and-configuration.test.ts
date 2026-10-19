import { describe, expect, it } from "vitest";
import { DisTube, Playlist, Song } from "../src";
import { FakeAdapter, FakeEngine, FakeSource, GUILD, playableSetup, setup, VOICE_CHANNEL } from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

describe("adapter target normalization", () => {
  // Core validates whatever the Adapter returns; per-adapter identity rules live in each adapter's tests.
  it.each([
    ["malformed", { guildId: "", channelId: VOICE_CHANNEL }],
    ["asynchronous", Promise.resolve({ guildId: GUILD, channelId: VOICE_CHANNEL })],
  ])("rejects %s normalization before registration", async (_kind, normalized) => {
    const source = new FakeSource("source");
    const adapter = Object.assign(new FakeAdapter(), { normalizeTarget: () => normalized as never });
    const harness = setup([source], { adapter });
    await expect(harness.distube.play(channel, "a")).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "guildId must be a non-empty string",
    });
    expect(harness.distube.queues.size).toBe(0);
    expect(source.search).not.toHaveBeenCalled();
    expect(adapter.createVoiceSession).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("classifies an Adapter that throws on a native target as INVALID_ARGUMENT with its cause", async () => {
    const source = new FakeSource("source");
    const conflict = new TypeError("Discord channel has conflicting guild identities");
    const adapter = Object.assign(new FakeAdapter(), {
      normalizeTarget: () => {
        throw conflict;
      },
    });
    const harness = setup([source], { adapter });
    const rejection = harness.distube.play(channel, "a");
    await expect(rejection).rejects.toMatchObject({ code: "INVALID_ARGUMENT", cause: conflict });
    await expect(harness.distube.voices.join(channel)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(harness.distube.queues.size).toBe(0);
    expect(adapter.createVoiceSession).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("shares one voice between join and play for a native target and refuses a cross-guild move", async () => {
    const harness = playableSetup();
    const native = { id: VOICE_CHANNEL, guild: { id: GUILD } };
    const voice = await harness.distube.voices.join(native);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(
      { guildId: GUILD, channelId: VOICE_CHANNEL },
      { selfDeaf: true, selfMute: false },
    );
    const queue = await harness.distube.play(native, "a");
    expect(queue.guildId).toBe(GUILD);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    await expect(voice.move({ id: "another", guild: { id: "other-guild" } })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      message: "Cannot move voice to another guild",
    });
    expect(voice.channelId).toBe(VOICE_CHANNEL);
    await harness.distube.dispose();
  });
});

describe("explicit engine configuration", () => {
  it.each([
    { initialize: "invalid", dispose: () => undefined },
    { initialize: () => undefined, dispose: "invalid" },
  ])("rejects noncallable engine lifecycle %# before initialization", hooks => {
    const source = new FakeSource("source");
    const engine = Object.assign(new FakeEngine(), hooks);
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [source], engine: engine as never })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(source.initialize).not.toHaveBeenCalled();
  });

  it("rejects a distinct engine that reuses a source name", () => {
    const source = new FakeSource("source");
    const engine = Object.assign(new FakeEngine(), { name: "source" });
    expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [source], engine })).toThrow(
      expect.objectContaining({ code: "INVALID_ARGUMENT" }),
    );
    expect(source.initialize).not.toHaveBeenCalled();
  });

  it("captures sources and selected engine before initialization callbacks", async () => {
    const source = new FakeSource("source");
    const late = new FakeSource("late");
    const sources = [source];
    source.initialize.mockImplementation(() => {
      sources.push(late);
    });
    const client = new DisTube({ adapter: new FakeAdapter(), sources });
    await expect(client.play(channel, "declined")).rejects.toMatchObject({ code: "NO_RESULT" });
    expect(late.initialize).not.toHaveBeenCalled();
    expect(late.search).not.toHaveBeenCalled();
    await client.dispose();
    expect(late.dispose).not.toHaveBeenCalled();
  });
});

it("rejects invalid voice settings before committing state", async () => {
  const harness = playableSetup();
  const voice = await harness.distube.voices.join(channel);
  await expect(voice.setVolume(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setVolume(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setVolume(101)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setSelfDeaf("yes" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.filters.set(1 as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.filters.set("")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect([voice.volume, voice.selfDeaf, voice.selfMute, voice.filters.names]).toEqual([100, true, false, []]);
  await harness.distube.dispose();
});

it("prevents concurrent ownership of a bare engine and allows reuse after disposal", async () => {
  const adapter = new FakeAdapter();
  const first = new DisTube({ adapter, sources: [] });
  expect(() => new DisTube({ adapter, sources: [] })).toThrow(expect.objectContaining({ code: "INVALID_STATE" }));
  await first.dispose();
  const second = new DisTube({ adapter, sources: [] });
  await second.dispose();
});

it("validates resolved media ownership without calling providers", async () => {
  const harness = playableSetup();
  const song = new Song({ source: "source", id: "a", name: "A", url: "https://source.example/a" });
  const playlist = new Playlist({
    source: "source",
    id: "list",
    name: "List",
    url: "https://source.example/list",
    songs: [song],
  });
  expect(await harness.distube.resolve(song)).toBe(song);
  expect(await harness.distube.resolve(playlist)).toBe(playlist);
  await expect(harness.distube.resolve(" ")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(harness.source.resolve).not.toHaveBeenCalled();
  expect(harness.source.search).not.toHaveBeenCalled();
  await harness.distube.dispose();
});
