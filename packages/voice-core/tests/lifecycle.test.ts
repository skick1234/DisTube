import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import type { Player, TrackEnd } from "distube/integrations";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscordVoiceEngine } from "../src/engine";
import { DiscordVoiceSession } from "../src/session";
import { createMedia, type MediaFixtures } from "./support/media";
import { gatewayAdapter, latest, native, resetNative, settle, noPlatform } from "./support/native";

vi.mock("@discordjs/voice", async () => (await import("./support/native")).voiceModule());

const CHANNEL_A = "channel-a";
const CHANNEL_B = "channel-b";

let media: MediaFixtures;

beforeAll(async () => {
  media = await createMedia();
}, 30_000);
afterAll(() => media.cleanup());
beforeEach(resetNative);

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
    report: () => undefined,
    channelBitrate: () => 64_000,
    preflight: () => undefined,
  });
  const player = await new DiscordVoiceEngine(
    {
      opusComplexity: 10,
      bufferMs: 500,
      report: () => undefined,
    },
    noPlatform,
  ).createPlayer(session, {
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

  it("closes the track's input on Player release and keeps the voice connection until the session leaves", async () => {
    const { session, player, input, ended } = await playing();
    const connection = latest.connection;

    await player.release();

    expect(input.destroyed).toBe(true);
    await expect(ended).resolves.toEqual({ reason: "stopped" });
    expect(connection.destroy).not.toHaveBeenCalled();
    expect(connection.state.status).toBe("ready");
    await session.release();
    expect(connection.destroy).toHaveBeenCalledOnce();
  });
});
