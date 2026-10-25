import { describe, expect, it } from "vitest";
import {
  capture,
  FakeVoiceSession,
  flushMicrotasks,
  GUILD,
  playableSetup,
  required,
  settle,
  VOICE_CHANNEL,
} from "./support/harness";

const channel = { guildId: GUILD, id: VOICE_CHANNEL };

describe("self-deaf and self-mute", () => {
  it("joins self-deafened and unmuted by default and reads both on the voice", async () => {
    const harness = playableSetup();

    const voice = await harness.distube.voices.join(channel);

    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(
      { guildId: GUILD, channelId: VOICE_CHANNEL },
      { selfDeaf: true, selfMute: false, timeoutMs: 15_000, signal: expect.any(AbortSignal) },
    );
    expect(required(harness.adapter.sessions[0]).states).toEqual([{ selfDeaf: true, selfMute: false }]);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([true, false]);
  });

  it("forwards explicit join options to the Adapter", async () => {
    const harness = playableSetup();

    const voice = await harness.distube.voices.join(channel, { selfDeaf: false, selfMute: true });

    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(
      { guildId: GUILD, channelId: VOICE_CHANNEL },
      { selfDeaf: false, selfMute: true, timeoutMs: 15_000, signal: expect.any(AbortSignal) },
    );
    expect([voice.selfDeaf, voice.selfMute]).toEqual([false, true]);
  });

  it("play joins with the defaults when no voice exists", async () => {
    const harness = playableSetup();

    await harness.distube.play(channel, "a");

    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(expect.anything(), {
      selfDeaf: true,
      selfMute: false,
      timeoutMs: 15_000,
      signal: expect.any(AbortSignal),
    });
  });

  it("writes runtime flags through setSelfState, never join, and commits after acknowledgement", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);

    await voice.setSelfDeaf(false);
    await voice.setSelfMute(true);

    expect(session.setSelfState.mock.calls).toEqual([[{ selfDeaf: false }], [{ selfMute: true }]]);
    expect(session.join).not.toHaveBeenCalled();
    expect(session.states.slice(1)).toEqual([
      { selfDeaf: false, selfMute: false },
      { selfDeaf: false, selfMute: true },
    ]);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([false, true]);
  });

  it("surfaces a session rejection as VOICE_FAILED and keeps the previous value", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);
    const failure = new Error("gateway rejected");
    session.setSelfState.mockRejectedValueOnce(failure);

    await expect(voice.setSelfMute(true)).rejects.toMatchObject({ code: "VOICE_FAILED", cause: failure });

    expect(voice.selfMute).toBe(false);
  });

  it("rejects a non-boolean with INVALID_ARGUMENT before touching the session", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);

    await expect(voice.setSelfDeaf("no" as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(voice.setSelfMute(1 as never)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(harness.distube.voices.join(channel, { selfDeaf: "yes" as never })).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
    });

    expect(session.setSelfState).not.toHaveBeenCalled();
  });

  it("survives queue.stop and a later play on the same voice", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel, { selfDeaf: false, selfMute: true });
    const queue = await harness.distube.play(channel, "a");
    await settle();

    await queue.stop();
    await harness.distube.play(channel, "b");
    await settle();

    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([false, true]);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-aborted join signal with ABORTED without creating a session", async () => {
    const harness = playableSetup();
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(harness.distube.voices.join(channel, { signal: controller.signal })).rejects.toMatchObject({
      code: "ABORTED",
    });

    expect(harness.adapter.createVoiceSession).not.toHaveBeenCalled();
    expect(harness.distube.voices.has(GUILD)).toBe(false);
  });

  it("rejects joins aborted during session creation with ABORTED and releases the late session once", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const first = new AbortController();
    const second = new AbortController();
    const joins = [first, second].map(controller =>
      capture(harness.distube.voices.join(channel, { signal: controller.signal })),
    );
    await flushMicrotasks(32);

    first.abort(new Error("caller gave up"));
    second.abort(new Error("caller gave up"));
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);

    expect(await Promise.all(joins)).toMatchObject([{ code: "ABORTED" }, { code: "ABORTED" }]);
    await settle();
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
    await harness.distube.voices.leave(GUILD);
    expect(session.release).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh session creation for the next join after every waiter abandoned the previous one", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const controller = new AbortController();
    const abandoned = capture(harness.distube.voices.join(channel, { signal: controller.signal }));
    await settle();
    controller.abort();
    expect(await abandoned).toMatchObject({ code: "ABORTED" });
    const late = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(late);
    await settle();
    expect(late.release).toHaveBeenCalledTimes(1);

    const voice = await harness.distube.voices.join(channel);
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(2);
  });

  it("aborts only its own caller when a concurrent join shares the session creation", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const controller = new AbortController();
    const aborted = capture(harness.distube.voices.join(channel, { signal: controller.signal }));
    const shared = harness.distube.voices.join(channel, { selfMute: true });
    await flushMicrotasks(32);

    controller.abort(new Error("caller gave up"));
    expect(await aborted).toMatchObject({ code: "ABORTED" });
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);

    const voice = await shared;
    expect(harness.distube.voices.get(GUILD)).toBe(voice);
    expect(voice.channelId).toBe(VOICE_CHANNEL);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([true, true]);
    expect(session.release).not.toHaveBeenCalled();
    expect(harness.adapter.createVoiceSession).toHaveBeenCalledTimes(1);
  });

  it("re-joining an existing voice writes only the flags that differ", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);

    await harness.distube.voices.join(channel, { selfDeaf: true, selfMute: false });
    expect(session.setSelfState).not.toHaveBeenCalled();
    await harness.distube.voices.join(channel, { selfDeaf: true, selfMute: true });

    expect(session.setSelfState.mock.calls).toEqual([[{ selfMute: true }]]);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([true, true]);
  });

  it("keeps the session's current state when the voice moves", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);
    await voice.setSelfDeaf(false);

    await voice.move({ guildId: GUILD, id: "other" });

    // An omitted flag keeps the session's current state, so a move sends only the channel.
    expect(session.join).toHaveBeenCalledWith("other");
    expect(session.channelId).toBe("other");
    expect([voice.selfDeaf, voice.selfMute]).toEqual([false, false]);
  });

  it("writes a self flag set during a held move to the channel the move acknowledged", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = harness.adapter.session;
    const ack = session.gateJoin();

    const writtenIn: string[] = [];
    const write = required(session.setSelfState.getMockImplementation());
    session.setSelfState.mockImplementationOnce(async state => {
      writtenIn.push(session.channelId);
      return write(state);
    });

    const moving = voice.move({ guildId: GUILD, id: "second" });
    const muting = voice.setSelfMute(true);
    await settle();
    expect(session.setSelfState).not.toHaveBeenCalled();
    ack.resolve();
    await Promise.all([moving, muting]);

    expect(session.join.mock.calls).toEqual([["second"]]);
    expect(session.setSelfState.mock.calls).toEqual([[{ selfMute: true }]]);
    expect(writtenIn).toEqual(["second"]);
    expect([voice.channelId, voice.selfMute]).toEqual(["second", true]);
  });
});
