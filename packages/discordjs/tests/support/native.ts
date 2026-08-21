import { EventEmitter } from "node:events";
import { vi } from "vitest";

export const CHANNEL = "channel";

/** Credentials a Ready connection exposes, which the session republishes as its gateway data. */
export const GATEWAY = { sessionId: "session", token: "token", endpoint: "voice.example" };

/** A native voice connection: state transitions are driven by the test, never by a real gateway. */
export class FakeConnection extends EventEmitter {
  state: Record<string, unknown> = {
    status: "ready",
    networking: { state: { connectionOptions: { ...GATEWAY, channelId: CHANNEL } } },
  };
  joinConfig: { channelId: string | null } = { channelId: CHANNEL };
  readonly subscribe = vi.fn((_player: unknown) => undefined);
  readonly rejoin = vi.fn((config: { channelId: string }) => {
    this.joinConfig = { channelId: config.channelId };
    return true;
  });
  readonly destroy = vi.fn(() => this.transition({ status: "destroyed" }));

  /** Announces one state transition exactly as `@discordjs/voice` would. */
  transition(next: Record<string, unknown>): void {
    const previous = this.state;
    this.state = next;
    this.emit("stateChange", previous, next);
  }
}

export class FakeAudioPlayer extends EventEmitter {
  state: { status: string } = { status: "idle" };
  readonly play = vi.fn((_resource: unknown) => undefined);
  readonly pause = vi.fn(() => true);
  readonly unpause = vi.fn(() => true);
  readonly stop = vi.fn(() => true);
}

export const native = {
  connections: [] as FakeConnection[],
  entersState: vi.fn(async (_target: unknown, _status: string, _timeout: number) => undefined),
  joinVoiceChannel: vi.fn(() => {
    const connection = new FakeConnection();
    native.connections.push(connection);
    return connection;
  }),
  createAudioPlayer: vi.fn(() => new FakeAudioPlayer()),
  createAudioResource: vi.fn(() => ({ playbackDuration: 0 })),
};

/** The connection the newest join produced. */
export function connection(): FakeConnection {
  return native.connections.at(-1) as FakeConnection;
}

export function resetNative(): void {
  // Resetting restores each fake's own implementation, so one test's override never leaks.
  vi.resetAllMocks();
  native.connections.length = 0;
}

/** Lets every pending microtask and detached teardown run before the test asserts. */
export function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** `@discordjs/voice` with only its four side-effecting factories replaced. */
export async function voiceModule(): Promise<unknown> {
  const actual = await vi.importActual<Record<string, unknown>>("@discordjs/voice");
  return {
    ...actual,
    createAudioPlayer: native.createAudioPlayer,
    createAudioResource: native.createAudioResource,
    entersState: native.entersState,
    joinVoiceChannel: native.joinVoiceChannel,
  };
}
