import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type { Client } from "eris";
import { vi } from "vitest";

export const GUILD = "guild";
export const CHANNEL = "channel";
export const GATEWAY = { channelId: CHANNEL, sessionId: "session", token: "token", endpoint: "voice.example" };

/** An Eris voice connection: playing and pausing follow its own calls, and a stop destroys its source. */
export class FakeVoiceConnection extends EventEmitter {
  channelID: string | null = CHANNEL;
  playing = false;
  paused = false;
  ready = true;
  current: { playTime: number } | undefined;
  /** The stream Eris would read Opus packets from. */
  source: Readable | undefined;
  readonly play = vi.fn((source: Readable, _options?: unknown) => {
    this.source = source;
    this.playing = true;
    this.current = { playTime: 0 };
  });
  stopPlaying = vi.fn(() => {
    this.source?.destroy();
    this.playing = false;
    this.current = undefined;
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly resume = vi.fn(() => {
    this.paused = false;
  });

  readonly #queue: Buffer[] = [];

  /** Eris's send loop: sends its queued packets, then the source's, adding 20 ms of `playTime` for each. */
  async send(count: number): Promise<Buffer[]> {
    const sent = this.#queue.splice(0, count);
    const current = this.current;
    if (current) current.playTime += sent.length * 20;
    sent.push(
      ...(await this.#read(count - sent.length, () => {
        if (current) current.playTime += 20;
      })),
    );
    return sent;
  }

  /** Eris's read-ahead: moves packets from the source into its queue without sending them. */
  async queue(count: number): Promise<void> {
    this.#queue.push(...(await this.#read(count)));
  }

  async #read(count: number, onPacket?: () => void): Promise<Buffer[]> {
    const packets: Buffer[] = [];
    const source = this.source;
    if (!source) return packets;
    while (packets.length < count) {
      const packet: unknown = source.read();
      if (Buffer.isBuffer(packet)) {
        packets.push(packet);
        onPacket?.();
        continue;
      }
      if (source.readableEnded || source.destroyed) break;
      await new Promise<void>(resolve => {
        const done = (): void => {
          for (const event of ["readable", "end", "close"]) source.off(event, done);
          resolve();
        };
        for (const event of ["readable", "end", "close"]) source.on(event, done);
      });
    }
    return packets;
  }

  /** Eris's reconnect handshake: ready, then an unconditional resume. */
  reconnect(): void {
    this.ready = true;
    this.emit("ready");
    this.resume();
  }

  /** A real completion reaches the Player through its temporary stopPlaying wrapper. */
  finishCurrent(): void {
    this.stopPlaying();
  }
}

/** A voice channel as the adapter's validation reads it: joinable, and owned by a guild. */
export function voiceChannel(guildId = GUILD): unknown {
  return { type: 2, join: () => undefined, guild: { id: guildId } };
}

/** An Eris client holding one guild's voice channel, whose shard echoes each voice state update. */
export class FakeClient extends EventEmitter {
  readonly user = { id: "bot" };
  readonly channels = new Map<string, unknown>([[CHANNEL, voiceChannel()]]);
  readonly sendWS = vi.fn(
    (_op: number, payload: { channel_id: string | null; self_deaf: boolean; self_mute: boolean }) => {
      if (payload.channel_id)
        queueMicrotask(() => {
          announceState(this, GATEWAY, GUILD, payload.channel_id, {
            self_deaf: payload.self_deaf,
            self_mute: payload.self_mute,
          });
          announceServer(this);
        });
    },
  );
  readonly guilds = new Map([[GUILD, { shard: { sendWS: this.sendWS } }]]);
  /** Sessions join through the shard; tests assert this native join stays unused. */
  readonly joinVoiceChannel = vi.fn((_channelId: string) => undefined);
  readonly getChannel = vi.fn((id: string) => this.channels.get(id));
}

export function asClient(client: FakeClient): Client {
  return client as unknown as Client;
}

/** The voice-server half of the credentials, which carries the token and endpoint. */
export function announceServer(client: FakeClient, gateway = GATEWAY, guildId = GUILD): void {
  client.emit("rawWS", {
    t: "VOICE_SERVER_UPDATE",
    d: { guild_id: guildId, token: gateway.token, endpoint: gateway.endpoint },
  });
}

/**
 * The voice-state half, which carries the bot's own session id.
 *
 * Pass `channelId` to report the channel Discord put the bot in, which is how an external move and a
 * removal (`null`) both reach the session.
 */
export function announceState(
  client: FakeClient,
  gateway = GATEWAY,
  guildId = GUILD,
  channelId?: string | null,
  flags: { self_mute?: boolean; self_deaf?: boolean } = {},
): void {
  client.emit("rawWS", {
    t: "VOICE_STATE_UPDATE",
    d: {
      guild_id: guildId,
      user_id: client.user.id,
      session_id: gateway.sessionId,
      ...(channelId === undefined ? {} : { channel_id: channelId }),
      ...flags,
    },
  });
}

/** Lets every pending microtask and detached teardown run before the test asserts. */
export function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
