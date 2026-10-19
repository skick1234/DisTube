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
      { selfDeaf: true, selfMute: false },
    );
    expect(required(harness.adapter.sessions[0]).states).toEqual([{ selfDeaf: true, selfMute: false }]);
    expect([voice.selfDeaf, voice.selfMute]).toEqual([true, false]);
  });

  it("forwards explicit join options to the Adapter", async () => {
    const harness = playableSetup();

    const voice = await harness.distube.voices.join(channel, { selfDeaf: false, selfMute: true });

    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(
      { guildId: GUILD, channelId: VOICE_CHANNEL },
      { selfDeaf: false, selfMute: true },
    );
    expect([voice.selfDeaf, voice.selfMute]).toEqual([false, true]);
  });

  it("play joins with the defaults when no voice exists", async () => {
    const harness = playableSetup();

    await harness.distube.play(channel, "a");

    expect(harness.adapter.createVoiceSession).toHaveBeenCalledWith(expect.anything(), {
      selfDeaf: true,
      selfMute: false,
    });
  });

  it("updates the gateway state at runtime and commits after acknowledgement", async () => {
    const harness = playableSetup();
    const voice = await harness.distube.voices.join(channel);
    const session = required(harness.adapter.sessions[0]);

    await voice.setSelfDeaf(false);
    await voice.setSelfMute(true);

    expect(session.setSelfDeaf).toHaveBeenCalledWith(false);
    expect(session.setSelfMute).toHaveBeenCalledWith(true);
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
    session.setSelfMute.mockRejectedValueOnce(failure);

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

    expect(session.setSelfDeaf).not.toHaveBeenCalled();
    expect(session.setSelfMute).not.toHaveBeenCalled();
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

  it("rejects a join aborted during session creation with ABORTED and releases the late session once", async () => {
    const harness = playableSetup();
    const creation = harness.adapter.gateCreateSession();
    const controller = new AbortController();
    const joining = capture(harness.distube.voices.join(channel, { signal: controller.signal }));
    await flushMicrotasks(32);

    controller.abort(new Error("caller gave up"));
    const session = new FakeVoiceSession(GUILD, VOICE_CHANNEL);
    creation.resolve(session);

    expect(await joining).toMatchObject({ code: "ABORTED" });
    await harness.distube.voices.leave(GUILD);
    expect(session.release).toHaveBeenCalledTimes(1);
    expect(harness.distube.voices.has(GUILD)).toBe(false);
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
});
