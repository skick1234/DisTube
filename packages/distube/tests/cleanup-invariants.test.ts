import { describe, expect, it, vi } from "vitest";
import type { Song } from "../src";
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
});

it("joins a pending reservation before reporting terminal cleanup failure", async () => {
  const harness = playableSetup();
  const queue = await harness.distube.play(channel, "a");
  await settle();
  const sourceResult = deferred<readonly Song[]>();
  harness.source.search.mockReturnValueOnce(sourceResult.promise);
  const insertion = capture(queue.add("late"));
  await flushMicrotasks(32);
  required(harness.engine.players[0]).stopTrack.mockRejectedValueOnce(new Error("stop failed"));
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
