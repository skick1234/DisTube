import { describe, expect, it, vi } from "vitest";
import {
  capture,
  deferred,
  FakePlayer,
  FakeVoiceSession,
  flushMicrotasks,
  GUILD,
  playableSetup,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

describe("cleanup ownership", () => {
  it("releases a created Player when subscription fails", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    vi.spyOn(player, "subscribe").mockImplementation(() => {
      throw new Error("subscribe failed");
    });
    harness.engine.createPlayer.mockResolvedValueOnce(player);
    await harness.distube.play(channel, "a");
    await settle();
    expect(player.release).toHaveBeenCalledTimes(1);
    await harness.distube.dispose().catch(() => undefined);
    expect(harness.adapter.sessions[0]?.release).toHaveBeenCalledTimes(1);
  });

  it("attempts Player and session release when both unsubscribe callbacks throw", async () => {
    const harness = playableSetup();
    const player = new FakePlayer();
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    vi.spyOn(player, "subscribe").mockReturnValue(() => {
      throw new Error("player unsubscribe");
    });
    vi.spyOn(session, "subscribe").mockReturnValue(() => {
      throw new Error("session unsubscribe");
    });
    harness.engine.createPlayer.mockResolvedValueOnce(player);
    harness.adapter.createVoiceSession.mockResolvedValueOnce(session);
    await harness.distube.play(channel, "a");
    await settle();
    await expect(harness.distube.dispose()).rejects.toMatchObject({
      code: "VOICE_FAILED",
      cause: expect.any(AggregateError),
    });
    expect(player.release).toHaveBeenCalledTimes(1);
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.source.dispose).toHaveBeenCalledTimes(1);
  });

  it("releases a fresh voice after all reservations fail without an adopter", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const controller = new AbortController();
    const search = required(harness.source.search.getMockImplementation());
    harness.source.search.mockImplementation(async (...args) => {
      if (args[0] === "bad") throw new Error("source rejected");
      return search(...args);
    });
    const first = capture(harness.distube.play(channel, "a", { signal: controller.signal }));
    const second = capture(harness.distube.play(channel, "bad"));
    await flushMicrotasks(32);
    controller.abort();
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);
    expect(await first).toMatchObject({ code: "ABORTED" });
    expect(await second).toMatchObject({ code: "SOURCE_FAILED" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    expect(session.release).toHaveBeenCalledTimes(1);
    await harness.distube.dispose();
  });
});

describe("filter cleanup ordering", () => {
  it("commits an empty selection only after backend acknowledgement", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]);
    await voice.setFilters(["bassboost", "bassboost", "nightcore"]);
    expect(voice.settings.filters).toEqual(["bassboost", "nightcore"]);
    const reset = player.gate("filters");
    const stopping = queue.stop();
    await reset.entered;
    expect(voice.settings.filters).toEqual(["bassboost", "nightcore"]);
    reset.resolve();
    await stopping;
    expect(voice.settings.filters).toEqual([]);
    await harness.distube.dispose();
  });

  it("keeps later filters behind cleanup while a Player is still being created", async () => {
    const harness = playableSetup();
    let deliver!: (player: FakePlayer) => void;
    const creation = new Promise<FakePlayer>(resolve => {
      deliver = resolve;
    });
    harness.engine.createPlayer.mockReturnValueOnce(creation);
    const { queue } = await harness.distube.play(channel, "a");
    await flushMicrotasks(32);
    const voice = required(harness.distube.voices.get(GUILD));
    const first = voice.setFilters(["bassboost"]);
    const stopping = queue.stop();
    const later = voice.setFilters(["nightcore"]);
    const player = new FakePlayer();
    deliver(player);
    await Promise.all([first, stopping, later]);
    expect(player.renders).toEqual([[{ name: "bassboost" }], [], [{ name: "nightcore" }]]);
    expect(voice.settings.filters).toEqual(["nightcore"]);
    await harness.distube.dispose();
  });

  it("preserves committed filters when terminal rendering fails", async () => {
    const harness = playableSetup();
    const { queue } = await harness.distube.play(channel, "a");
    await settle();
    const voice = required(harness.distube.voices.get(GUILD));
    const player = required(harness.engine.players[0]);
    await voice.setFilters(["bassboost"]);
    player.setFilters.mockRejectedValueOnce(new Error("reset failed"));
    await expect(queue.stop()).rejects.toMatchObject({ code: "VOICE_FAILED" });
    expect(harness.distube.getQueue(GUILD)).toBeUndefined();
    expect(voice.settings.filters).toEqual(["bassboost"]);
    await harness.distube.dispose().catch(() => undefined);
  });
});

it("joins a pending reservation before reporting terminal cleanup failure", async () => {
  const harness = playableSetup();
  const { queue } = await harness.distube.play(channel, "a");
  await settle();
  const sourceResult = deferred<readonly import("../src").Song[]>();
  harness.source.search.mockReturnValueOnce(sourceResult.promise);
  const insertion = capture(queue.enqueue("late"));
  await flushMicrotasks(32);
  required(harness.engine.players[0]).setFilters.mockRejectedValueOnce(new Error("reset failed"));
  let settled = false;
  const stopping = capture(queue.stop()).then(result => {
    settled = true;
    return result;
  });
  await flushMicrotasks(64);
  expect(settled).toBe(false);
  sourceResult.resolve([]);
  expect(await stopping).toMatchObject({ code: "VOICE_FAILED" });
  expect(await insertion).toMatchObject({ code: "INVALID_STATE" });
  await harness.distube.dispose().catch(() => undefined);
});

it("clears filters on an existing voice when first resolution fails", async () => {
  const harness = playableSetup();
  const voice = await harness.distube.voices.join(channel);
  await voice.setFilters(["bassboost"]);
  harness.source.search.mockRejectedValueOnce(new Error("source failed"));
  await expect(harness.distube.play(channel, "bad")).rejects.toMatchObject({ code: "SOURCE_FAILED" });
  expect(voice.settings.filters).toEqual([]);
  expect(harness.distube.voices.get(GUILD)).toBe(voice);
  await harness.distube.dispose();
});

it("retains source failure and failed filter reset in one play cleanup error", async () => {
  const harness = playableSetup();
  const first = await harness.distube.play(channel, "a");
  await settle();
  await first.queue.stop();
  const provider = new Error("provider failed");
  const reset = new Error("reset failed");
  harness.source.search.mockRejectedValueOnce(provider);
  required(harness.engine.players[0]).setFilters.mockRejectedValueOnce(reset);
  const failure = await capture(harness.distube.play(channel, "bad"));
  expect(failure).toMatchObject({ code: "SOURCE_FAILED", cause: expect.any(AggregateError) });
  expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  expect(harness.distube.voices.has(GUILD)).toBe(true);
  await harness.distube.dispose().catch(() => undefined);
});

it("retains caller cancellation and failed solely-owned voice cleanup", async () => {
  const harness = playableSetup();
  const creation = harness.adapter.gateCreateSession();
  const controller = new AbortController();
  const pending = capture(harness.distube.play(channel, "a", { signal: controller.signal }));
  await flushMicrotasks(32);
  controller.abort(new Error("caller cancelled"));
  const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
  session.release.mockRejectedValueOnce(new Error("session release failed"));
  creation.resolve(session);
  expect(await pending).toMatchObject({ code: "ABORTED", cause: expect.any(AggregateError) });
  expect(harness.distube.getQueue(GUILD)).toBeUndefined();
  expect(session.release).toHaveBeenCalledTimes(1);
  await harness.distube.dispose().catch(() => undefined);
});
