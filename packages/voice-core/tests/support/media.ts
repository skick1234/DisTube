import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline, type Readable, Transform } from "node:stream";
import type { ReaderPlaybackResource } from "distube/integrations";
import {
  AV_CH_LAYOUT_STEREO,
  AV_CHANNEL_ORDER_NATIVE,
  AV_SAMPLE_FMT_FLTP,
  AV_SAMPLE_FMT_S16,
  Decoder,
  Demuxer,
  Encoder,
  FF_ENCODER_AAC,
  FF_ENCODER_FLAC,
  FF_ENCODER_LIBOPUS,
  FF_ENCODER_PCM_S16LE,
  Frame,
  Muxer,
  Packet,
} from "node-av";
import type { TrackSettings } from "../../src/track";

const RATE = 48_000;

/** Track settings that leave the source untouched and never cap its bitrate. */
export const PLAIN: TrackSettings = {
  volume: 100,
  chain: undefined,
  bitrate: 510_000,
  opusComplexity: 10,
  readAhead: 25,
};

/** Media files generated with node-av's own encoders and muxers, deleted by `cleanup`. */
export interface MediaFixtures {
  readonly dir: string;
  /** Six seconds of WebM Opus, 48 kHz stereo in 20 ms packets. */
  readonly opus: string;
  /** Two seconds of WebM Opus in 60 ms packets, which Discord cannot take unchanged. */
  readonly opus60: string;
  /** Five seconds of MP4 AAC at 160 kbps. */
  readonly aac: string;
  /** Ten seconds of AAC in MPEG-TS, the segment format of live HLS, longer than libav's 7-second TS analysis. */
  readonly ts: string;
  /** Five seconds of FLAC in Matroska, whose container reports no bitrate when streamed. */
  readonly flac: string;
  /** One hour of WebM Opus at 32 kbps, one encoded second repeated. */
  readonly hour: string;
  /** Five seconds of PCM in Matroska in one-second packets of 192,000 bytes. */
  readonly pcm: string;
  /** One second of Matroska audio whose codec ID libav does not know, so no decoder exists for it. */
  readonly undecodable: string;
  /** About 16 seconds of PCM in Matroska in packets of 1 MiB, each larger than the read-ahead. */
  readonly huge: string;
  /** Two seconds of a loud 440 Hz tone, then eight seconds of silence, in PCM Matroska. */
  readonly toneThenSilence: string;
  cleanup(): Promise<void>;
}

export async function createMedia(): Promise<MediaFixtures> {
  const dir = await mkdtemp(join(tmpdir(), "distube-voice-core-"));
  const opus = join(dir, "opus.webm");
  const opus60 = join(dir, "opus60.webm");
  const aac = join(dir, "aac.m4a");
  const ts = join(dir, "aac.ts");
  const flac = join(dir, "flac.mkv");
  const hour = join(dir, "hour.webm");
  const pcm = join(dir, "pcm.mkv");
  const undecodable = join(dir, "undecodable.mkv");
  const huge = join(dir, "huge.mkv");
  const toneThenSilence = join(dir, "tone.mkv");
  await encode(opus, "webm", opusEncoder(256_000), 6);
  await encode(opus60, "webm", opusEncoder(96_000, 60), 2);
  await encode(aac, "mp4", Encoder.createSync(FF_ENCODER_AAC, { bitrate: 160_000, autoResample: true }), 5);
  await encode(ts, "mpegts", Encoder.createSync(FF_ENCODER_AAC, { bitrate: 128_000, autoResample: true }), 10);
  await encode(flac, "matroska", Encoder.createSync(FF_ENCODER_FLAC), 5);
  await repeat(hour, 3600);
  await encode(pcm, "matroska", Encoder.createSync(FF_ENCODER_PCM_S16LE), 5, RATE);
  await encode(undecodable, "matroska", Encoder.createSync(FF_ENCODER_PCM_S16LE), 1);
  await renameCodec(undecodable, "A_PCM/INT/LIT", "A_XYZ/INT/LIT");
  await encode(huge, "matroska", Encoder.createSync(FF_ENCODER_PCM_S16LE), 11, 262_144);
  await encode(toneThenSilence, "matroska", Encoder.createSync(FF_ENCODER_PCM_S16LE), 10, 960, toneUntil(2 * RATE));
  return {
    dir,
    opus,
    opus60,
    aac,
    ts,
    flac,
    hour,
    pcm,
    undecodable,
    huge,
    toneThenSilence,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Every audio packet's bytes as the container stores them. */
export async function sourcePackets(path: string): Promise<Buffer[]> {
  const demuxer = await Demuxer.open(path);
  const packet = new Packet();
  packet.alloc();
  const packets: Buffer[] = [];
  try {
    const context = demuxer.getFormatContext();
    while (context.readFrameSync(packet) >= 0) {
      if (packet.data) packets.push(packet.data);
      packet.unref();
    }
    return packets;
  } finally {
    packet.free();
    await demuxer.close();
  }
}

function opusEncoder(bitsPerSecond: number, frameDuration = 20): Encoder {
  return Encoder.createSync(FF_ENCODER_LIBOPUS, {
    bitrate: bitsPerSecond,
    options: { application: "audio", frame_duration: frameDuration },
  });
}

/** Seeded noise, independent per channel, so encoders spend their bitrate and filters change the bytes. */
function samples(start: number, count: number): Buffer {
  const buffer = Buffer.alloc(count * 4);
  let seed = start + 1;
  for (let offset = 0; offset < buffer.length; offset += 2) {
    seed = (Math.imul(seed, 1_103_515_245) + 12_345) & 0x7fffffff;
    buffer.writeInt16LE(Math.round(((seed / 0x7fffffff) * 2 - 1) * 16_000), offset);
  }
  return buffer;
}

function toneUntil(end: number): (start: number, count: number) => Buffer {
  return (start, count) => {
    const buffer = Buffer.alloc(count * 4);
    for (let index = 0; index < count && start + index < end; index += 1) {
      const value = Math.round(Math.sin((2 * Math.PI * 440 * (start + index)) / RATE) * 20_000);
      buffer.writeInt16LE(value, index * 4);
      buffer.writeInt16LE(value, index * 4 + 2);
    }
    return buffer;
  };
}

function frame(start: number, count: number, fill = samples): Frame {
  return Frame.fromAudioBuffer(fill(start, count), {
    nbSamples: count,
    format: AV_SAMPLE_FMT_S16,
    sampleRate: RATE,
    channelLayout: { nbChannels: 2, order: AV_CHANNEL_ORDER_NATIVE, mask: AV_CH_LAYOUT_STEREO },
    timeBase: { num: 1, den: RATE },
    pts: BigInt(start),
  });
}

async function encode(
  path: string,
  format: string,
  encoder: Encoder,
  seconds: number,
  frameSamples = 960,
  fill = samples,
): Promise<void> {
  const muxer = await Muxer.open(path, { format });
  try {
    const stream = muxer.addStream(encoder);
    const write = (packets: Iterable<Packet>): void => {
      for (const packet of packets) {
        muxer.writePacketSync(packet, stream);
        packet.free();
      }
    };
    for (let start = 0; start < seconds * RATE; start += frameSamples) {
      const input = frame(start, frameSamples, fill);
      write(encoder.encodeAllSync(input));
      input.free();
    }
    write(encoder.flushPacketsSync());
    await muxer.close();
  } finally {
    encoder.close();
  }
}

async function renameCodec(path: string, from: string, to: string): Promise<void> {
  const bytes = await readFile(path);
  const offset = bytes.indexOf(from);
  if (offset < 0 || from.length !== to.length) throw new Error(`No ${from} codec ID to rename`);
  bytes.write(to, offset);
  await writeFile(path, bytes);
}

/** Muxes one encoded second over and over, which builds a long file in a fraction of a second. */
async function repeat(path: string, seconds: number): Promise<void> {
  const encoder = opusEncoder(32_000);
  const muxer = await Muxer.open(path, { format: "webm" });
  const second: Packet[] = [];
  try {
    const stream = muxer.addStream(encoder);
    for (let start = 0; start < RATE; start += 960) {
      const input = frame(start, 960);
      second.push(...encoder.encodeAllSync(input));
      input.free();
    }
    for (let index = 0; index < seconds * 50; index += 1) {
      const packet = (second[index % second.length] as Packet).clone();
      if (!packet) continue;
      packet.pts = BigInt(index * 960);
      packet.dts = packet.pts;
      muxer.writePacketSync(packet, stream);
      packet.free();
    }
    await muxer.close();
  } finally {
    for (const packet of second) packet.free();
    encoder.close();
  }
}

/** Reads up to `count` packets without ending the stream, stopping early only when it ends or closes. */
export async function take(packets: Readable, count: number): Promise<Buffer[]> {
  const taken: Buffer[] = [];
  while (taken.length < count) {
    const chunk: unknown = packets.read();
    if (Buffer.isBuffer(chunk)) {
      taken.push(chunk);
      continue;
    }
    if (packets.readableEnded || packets.destroyed) break;
    await new Promise<void>(resolve => {
      const done = (): void => {
        packets.off("readable", done);
        packets.off("close", done);
        resolve();
      };
      packets.on("readable", done);
      packets.on("close", done);
    });
  }
  return taken;
}

export async function peak(packets: readonly Buffer[], template: string): Promise<number> {
  const demuxer = await Demuxer.open(template);
  const stream = demuxer.audio();
  if (!stream) throw new Error(`${template} has no audio stream`);
  const decoder = Decoder.createSync(stream);
  const packet = new Packet();
  packet.alloc();
  let loudest = 0;
  try {
    for (const bytes of packets) {
      packet.data = bytes;
      for (const decoded of decoder.decodeAllSync(packet)) {
        if (decoded.format !== AV_SAMPLE_FMT_FLTP) throw new Error("Expected planar float samples");
        for (const plane of decoded.data ?? []) {
          for (let offset = 0; offset + 4 <= decoded.nbSamples * 4; offset += 4) {
            loudest = Math.max(loudest, Math.abs(plane.readFloatLE(offset)));
          }
        }
        decoded.free();
      }
      packet.unref();
    }
    return loudest;
  } finally {
    packet.free();
    decoder.close();
    await demuxer.close();
  }
}

/** Average bits per second of 20 ms Opus packets. */
export function bitrate(packets: readonly Buffer[]): number {
  return (packets.reduce((total, packet) => total + packet.length, 0) * 8) / (packets.length * 0.02);
}

export interface ReaderProbe {
  readonly resource: ReaderPlaybackResource;
  readonly ranges: [number, number][];
  readonly readables: Readable[];
  /** Bytes handed to the engine so far. */
  delivered: number;
}

/** A reader over a local file that records every range and counts the bytes it hands out. */
export async function fileReader(
  path: string,
  read?: (start: number, end: number) => Readable | undefined,
): Promise<ReaderProbe> {
  const { size } = await stat(path);
  const probe: ReaderProbe = {
    ranges: [],
    readables: [],
    delivered: 0,
    resource: {
      kind: "reader",
      size,
      container: path.endsWith(".webm") ? "webm" : "mp4",
      read(start, end) {
        probe.ranges.push([start, end]);
        const counter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            probe.delivered += chunk.length;
            callback(null, chunk);
          },
        });
        const readable =
          read?.(start, end) ?? pipeline(createReadStream(path, { start, end }), counter, () => undefined);
        probe.readables.push(readable);
        return readable;
      },
    },
  };
  return probe;
}
