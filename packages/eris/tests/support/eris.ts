import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { Client } from "eris";
import { vi } from "vitest";

export const GUILD = "guild";
export const CHANNEL = "channel";
export const GATEWAY = { channelId: CHANNEL, sessionId: "session", token: "token", endpoint: "voice.example" };

/** An Eris voice connection: playing, pausing, and the elapsed clock all follow its own calls. */
export class FakeVoiceConnection extends EventEmitter {
  channelID: string | null = CHANNEL;
  playing = false;
  paused = false;
  ready = true;
  current: { playTime: number } | undefined;
  readonly play = vi.fn((_source: unknown, _options?: unknown) => {
    this.playing = true;
    this.current = { playTime: 0 };
  });
  stopPlaying = vi.fn(() => {
    this.playing = false;
    this.current = undefined;
  });
  readonly pause = vi.fn(() => {
    this.paused = true;
  });
  readonly resume = vi.fn(() => {
    this.paused = false;
  });
  readonly setVolume = vi.fn((_level: number) => undefined);

  /** A real completion reaches the Player through its temporary stopPlaying wrapper. */
  finishCurrent(): void {
    this.stopPlaying();
  }
}

/** A package-owned FFmpeg child whose lifecycle tests drive without a real process. */
export class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: string | null = null;
  /** Records the kill request. Tests must explicitly emit close to settle the decoder outcome. */
  readonly kill = vi.fn((signal: string) => {
    this.signalCode = signal;
    return true;
  });

  close(code: number | null = this.exitCode, signal: string | null = this.signalCode): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("close", code, signal);
  }
}

export const native = {
  children: [] as FakeChild[],
  spawns: [] as string[][],
  autoAudio: true,
  spawn: vi.fn((_command: string, args: string[]) => {
    native.spawns.push(args);
    const child = new FakeChild();
    native.children.push(child);
    if (native.autoAudio) queueMicrotask(() => child.stdout.write(Buffer.from([0])));
    return child;
  }),
};

export const latest = {
  get child(): FakeChild {
    return native.children.at(-1) as FakeChild;
  },
  get spawn(): string[] {
    return native.spawns.at(-1) as string[];
  },
};

/** Completes the exact stream that currently belongs to this fake connection. */
export function finishCurrent(connection: FakeVoiceConnection): void {
  connection.finishCurrent();
}

export function resetNative(): void {
  vi.resetAllMocks();
  native.children.length = 0;
  native.spawns.length = 0;
  native.autoAudio = true;
}

export async function childProcessModule(): Promise<unknown> {
  const actual = await vi.importActual<Record<string, unknown>>("node:child_process");
  return { ...actual, spawn: native.spawn };
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
