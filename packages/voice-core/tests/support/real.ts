import { execFileSync } from "node:child_process";
import { createDecipheriv, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as createSecureServer } from "node:https";
import { createSocket } from "node:dgram";
import type { Duplex } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCACertificates, setDefaultCACertificates } from "node:tls";
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

/** One audio packet as the voice server received it. */
export interface HeardPacket {
  /** `performance.now()` when the datagram arrived. */
  readonly at: number;
  /** The decrypted Opus payload. */
  readonly opus: Buffer;
}

export interface VoiceGatewayServer {
  /** The `host:port` a voice server update names, as Discord sends it. */
  readonly endpoint: string;
  /** Voice WebSocket connections the library has opened so far. */
  readonly connections: number;
  /** Every audio packet received over UDP so far, in arrival order. */
  readonly heard: readonly HeardPacket[];
  /** Whether a new voice socket is answered up to Ready; a silent one never gets past Identify. */
  answers: boolean;
  /** Closes every open voice socket with `code`, as Discord does when it ends a voice session. */
  close(code: number): void;
  /** Stops listening and drops every socket, so the library's next dial is refused. */
  stop(): Promise<void>;
}

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const SSRC = 1;
const SECRET_KEY = Buffer.alloc(32, 1);
const RTP_HEADER_BYTES = 12;
const RTP_OPUS_PAYLOAD_TYPE = 0x78;
const AUTH_TAG_BYTES = 16;
const NONCE_SUFFIX_BYTES = 4;

let certificate: { readonly key: Buffer; readonly cert: Buffer } | undefined;

/**
 * A local Discord voice server over TLS and UDP. It completes the voice handshake far enough for the real
 * library to reach Ready: Hello, Ready, IP discovery and a session description without DAVE. It decrypts
 * and records every audio packet; it does not cover DAVE or Discord's real network.
 */
export async function serveVoiceGateway(): Promise<VoiceGatewayServer> {
  const { key, cert } = trustedCertificate();
  const udp = createSocket("udp4");
  const heard: HeardPacket[] = [];
  udp.on("message", (message, remote) => {
    if (message[0] === 0x80 && message[1] === RTP_OPUS_PAYLOAD_TYPE) {
      heard.push({ at: performance.now(), opus: decryptRtpSize(message) });
      return;
    }
    if (message.length !== 74 || message.readUInt16BE(0) !== 1) return;
    const reply = Buffer.alloc(74);
    reply.writeUInt16BE(2, 0);
    reply.writeUInt16BE(70, 2);
    reply.writeUInt32BE(SSRC, 4);
    reply.write(remote.address, 8);
    reply.writeUInt16BE(remote.port, 72);
    udp.send(reply, remote.port, remote.address);
  });
  await new Promise<void>(resolve => udp.bind(0, "127.0.0.1", resolve));
  const sockets = new Set<Duplex>();
  let connections = 0;
  const server = createSecureServer({ key, cert });
  const gateway: VoiceGatewayServer = {
    endpoint: "",
    get connections() {
      return connections;
    },
    answers: true,
    heard,
    close: code => {
      for (const socket of sockets) socket.end(Buffer.from([0x88, 2, code >> 8, code & 0xff]));
    },
    stop: async () => {
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      for (const socket of sockets) socket.destroy();
      udp.close();
      await closed;
    },
  };
  server.on("upgrade", (request, socket: Duplex) => {
    connections += 1;
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => sockets.delete(socket));
    const accept = createHash("sha1")
      .update(`${request.headers["sec-websocket-key"]}${WEBSOCKET_GUID}`)
      .digest("base64");
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    if (!gateway.answers) return;
    const send = (packet: unknown): void => void socket.write(textFrame(JSON.stringify(packet)));
    send({ op: 8, d: { heartbeat_interval: 60_000 } });
    readTextFrames(socket, text => {
      const packet = JSON.parse(text) as { op: number; d: { t?: number; data?: { mode?: string } } };
      if (packet.op === 0) {
        const { port } = udp.address();
        send({ op: 2, d: { ssrc: SSRC, ip: "127.0.0.1", port, modes: ["aead_aes256_gcm_rtpsize"] } });
      } else if (packet.op === 1) {
        send({ op: 4, d: { mode: packet.d.data?.mode, secret_key: [...SECRET_KEY], dave_protocol_version: 0 } });
      } else if (packet.op === 3) {
        send({ op: 6, d: { t: packet.d.t } });
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("Expected a TCP address");
  return Object.assign(gateway, { endpoint: `127.0.0.1:${address.port}` });
}

/** Opens one `aead_aes256_gcm_rtpsize` packet: RTP header as AAD, then ciphertext, tag and a 4-byte nonce suffix. */
function decryptRtpSize(packet: Buffer): Buffer {
  const header = packet.subarray(0, RTP_HEADER_BYTES);
  const tagStart = packet.length - NONCE_SUFFIX_BYTES - AUTH_TAG_BYTES;
  const nonce = Buffer.alloc(12);
  packet.copy(nonce, 0, packet.length - NONCE_SUFFIX_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", SECRET_KEY, nonce);
  decipher.setAAD(header);
  decipher.setAuthTag(packet.subarray(tagStart, tagStart + AUTH_TAG_BYTES));
  return Buffer.concat([decipher.update(packet.subarray(RTP_HEADER_BYTES, tagStart)), decipher.final()]);
}

function textFrame(text: string): Buffer {
  const payload = Buffer.from(text);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, payload.length])
      : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

/** Unmasks the client's text frames; the library sends nothing larger than a 16-bit length here. */
function readTextFrames(socket: Duplex, onText: (text: string) => void): void {
  let pending = Buffer.alloc(0);
  socket.on("data", (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length >= 2) {
      const short = pending[1] & 0x7f;
      const offset = short === 126 ? 4 : 2;
      if (pending.length < offset) return;
      const length = short === 126 ? pending.readUInt16BE(2) : short;
      const end = offset + 4 + length;
      if (pending.length < end) return;
      const mask = pending.subarray(offset, offset + 4);
      const payload = Buffer.from(pending.subarray(offset + 4, end)).map((byte, index) => byte ^ mask[index % 4]);
      const opcode = pending[0] & 0x0f;
      pending = pending.subarray(end);
      if (opcode === 1) onText(Buffer.from(payload).toString());
    }
  });
}

/** A throwaway certificate for 127.0.0.1 that this process trusts, because the library only dials `wss://`. */
function trustedCertificate(): { readonly key: Buffer; readonly cert: Buffer } {
  if (certificate) return certificate;
  const directory = mkdtempSync(join(tmpdir(), "voice-gateway-"));
  try {
    const keyPath = join(directory, "key.pem");
    const certPath = join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        certPath,
      ],
      { stdio: "ignore" },
    );
    certificate = { key: readFileSync(keyPath), cert: readFileSync(certPath) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  setDefaultCACertificates([...getCACertificates("default"), certificate.cert]);
  return certificate;
}
