import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { Player, TrackEnd } from "distube/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { createMedia, type MediaFixtures } from "./support/media";
import { gatewayAdapter, latest, native, resetNative, settle } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const CHANNEL_A = "channel-a";
const CHANNEL_B = "channel-b";

let media: MediaFixtures;

beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());
beforeEach(resetNative);

/** A track whose stream input stays open until the Player closes it. */
async function playing(): Promise<{
  session: DiscordVoiceSession;
  player: Player;
  input: PassThrough;
  ended: Promise<TrackEnd>;
}> {
  const session = await DiscordVoiceSession.connect({
    guildId: "guild",
    channelId: CHANNEL_A,
    clientUserId: "bot",
    adapterCreator: gatewayAdapter().creator,
    selfDeaf: true,
    selfMute: false,
    timeoutMs: 15_000,
    channelBitrate: () => 64_000,
    preflight: () => undefined,
  });
  const player = await new DiscordVoiceEngine({ opusComplexity: 10, bufferMs: 500 }).createPlayer(session, {
    onClosed: () => undefined,
  });
  const input = new PassThrough();
  input.write((await readFile(media.hour)).subarray(0, 400_000));
  const { promise: started, resolve } = Promise.withResolvers<void>();
  const ended = player.play(
    { kind: "stream", stream: input },
    { signal: new AbortController().signal, onStart: resolve },
  );
  await started;
  return { session, player, input, ended };
}

describe("DiscordVoiceSession playback lifecycle", () => {
  it("moves the session and its native connection without ending the active track", async () => {
    const { session, player, ended } = await playing();
    let settled = false;
    void ended.finally(() => {
      settled = true;
    });

    await session.join(CHANNEL_B);
    await settle();

    expect(session.channelId).toBe(CHANNEL_B);
    expect(native.connections).toHaveLength(1);
    expect(latest.connection.destroy).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    await player.release();
    await session.release();
  });

  it("closes every input before it destroys the voice connection on release", async () => {
    const { session, player, input, ended } = await playing();
    const connection = latest.connection;
    let inputClosedAtDestroy: boolean | undefined;
    connection.destroy.mockImplementationOnce(() => {
      inputClosedAtDestroy = input.destroyed;
      connection.transition({ status: "destroyed" });
    });

    await player.release();

    expect(inputClosedAtDestroy).toBe(true);
    expect(connection.destroy).toHaveBeenCalledOnce();
    await expect(ended).resolves.toEqual({ reason: "stopped" });
    await session.release();
  });
});
