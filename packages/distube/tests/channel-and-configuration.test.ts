import { describe, expect, it } from "vitest";
import { DisTube, Playlist, Song } from "../src";
import { FakeAdapter, FakeEngine, FakeSource, GUILD, playableSetup, VOICE_CHANNEL } from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

describe("structural channel normalization", () => {
  it.each([
    null,
    "voice",
    { id: VOICE_CHANNEL },
    { id: VOICE_CHANNEL, guild: null },
    { id: VOICE_CHANNEL, guild: "guild" },
    { id: VOICE_CHANNEL, guild: {} },
    { id: VOICE_CHANNEL, guild: { id: "" } },
    { id: VOICE_CHANNEL, guild: { id: GUILD }, guildId: "" },
    { id: VOICE_CHANNEL, guild: {}, guildId: GUILD },
    { id: VOICE_CHANNEL, guild: { id: "different" }, guildId: GUILD },
    { id: " voice", guildId: GUILD },
    { id: VOICE_CHANNEL, guildId: "guild " },
    { id: VOICE_CHANNEL, guild: { id: "guild " } },
  ])("rejects malformed or inconsistent native identity %# before registration", async target => {
    const harness = playableSetup();
    await expect(harness.distube.play(target as never, "a")).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(harness.distube.queues.size).toBe(0);
    expect(harness.source.search).not.toHaveBeenCalled();
    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    await harness.distube.dispose();
  });

  it("accepts nested guild identity and agreeing native identity forms", async () => {
    const harness = playableSetup();
    const native = { id: VOICE_CHANNEL, guild: { id: GUILD }, extraNativeField: {} };
    const voice = await harness.distube.voices.join(native);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith({ guildId: GUILD, channelId: VOICE_CHANNEL });
    const { queue } = await harness.distube.play({ ...native, guildId: GUILD }, "a");
    expect(queue.guildId).toBe(GUILD);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    await expect(voice.move({ id: "another", guild: { id: "other-guild" } })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });
    await harness.distube.dispose();
  });
});

describe("explicit engine configuration", () => {
  it.each([
    { initialize: () => undefined },
    { dispose: () => undefined },
    { initialize: "invalid", dispose: () => undefined },
    { initialize: () => undefined, dispose: "invalid" },
  ])("rejects incomplete engine lifecycle %# before initialization", hooks => {
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
    await expect(client.play(channel, "declined")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
    expect(late.initialize).not.toHaveBeenCalled();
    expect(late.search).not.toHaveBeenCalled();
    await client.dispose();
    expect(late.dispose).not.toHaveBeenCalled();
  });
});

it("rejects invalid voice settings before committing state", async () => {
  const harness = playableSetup();
  const voice = await harness.distube.voices.join(channel);
  await expect(voice.setRepeat("forever" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setAutoplay("yes" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setVolume(Number.NaN)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setVolume(-1)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(voice.setFilters([1] as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  expect(voice.settings).toEqual({ volume: 100, repeat: "off", autoplay: false, filters: [] });
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

it("requires diagnostic consumers to be callable", () => {
  expect(() => new DisTube({ adapter: new FakeAdapter(), sources: [], onDiagnostic: 1 as never })).toThrow(
    expect.objectContaining({ code: "INVALID_ARGUMENT" }),
  );
});
