import { createServer } from "node:http";
import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterLibraryMethods } from "@discordjs/voice";

export const REAL_GUILD = "real-guild";
export const REAL_CHANNEL = "real-channel";

/**
 * A gateway adapter that answers the real library without a Discord connection.
 *
 * `@discordjs/voice` drives its whole state machine through this seam, so a suite that owns it can
 * deliver genuine `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE` payloads to real library code.
 */
export interface CapturedGateway {
  readonly creator: DiscordGatewayAdapterCreator;
  readonly payloads: unknown[];
  /** The library's own callbacks, available once it has created the adapter. */
  methods(): DiscordGatewayAdapterLibraryMethods;
}

export function captureGateway(): CapturedGateway {
  const payloads: unknown[] = [];
  let captured: DiscordGatewayAdapterLibraryMethods | undefined;
  return {
    payloads,
    creator: ((methods: DiscordGatewayAdapterLibraryMethods) => {
      captured = methods;
      return {
        sendPayload: (payload: unknown) => {
          payloads.push(payload);
          return true;
        },
        destroy: () => undefined,
      };
    }) as unknown as DiscordGatewayAdapterCreator,
    methods: () => {
      if (!captured) throw new Error("The library has not created its gateway adapter yet");
      return captured;
    },
  };
}

/** The voice-state payload Discord sends when it puts the bot in `channelId`; `null` is a removal. */
export function voiceState(
  channelId: string | null,
  sessionId = "real-session",
): Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0] {
  return {
    channel_id: channelId,
    guild_id: REAL_GUILD,
    user_id: "bot",
    session_id: sessionId,
  } as unknown as Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0];
}

/** A minimal 16-bit mono WAV of silence, which libav decodes without any network fixture. */
export function silentWav(seconds = 1, sampleRate = 8000): Uint8Array {
  const samples = seconds * sampleRate;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

export interface AudioOrigin {
  readonly url: string;
  stop(): Promise<void>;
}

/** Serves the silent WAV over real HTTP, so the engine fetches an absolute URL exactly as it would in production. */
export async function serveAudio(): Promise<AudioOrigin> {
  const body = Buffer.from(silentWav());
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "audio/wav", "content-length": String(body.byteLength) });
    response.end(body);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Expected a TCP address");
  return {
    url: `http://127.0.0.1:${address.port}/audio.wav`,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
}
