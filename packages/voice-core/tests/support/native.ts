import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type {
  AudioPlayerError,
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
} from "@discordjs/voice";
import { type Mock, vi } from "vitest";

/** Credentials a Ready connection exposes, which the session republishes as its gateway data. */
export const GATEWAY = { channelId: "channel", sessionId: "session", token: "token", endpoint: "voice.example" };

export const CHANNEL = "channel";

/** The platform gateway half, shared by remote-only and late local-transport tests. */
export function gatewayAdapter(userId = "bot"): {
  readonly creator: DiscordGatewayAdapterCreator;
  readonly sendPayload: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  state(channelId: string | null, sessionId?: string, selfDeaf?: boolean, selfMute?: boolean): void;
  server(token?: string, endpoint?: string | null): void;
} {
  let methods: DiscordGatewayAdapterLibraryMethods | undefined;
  const state = (channelId: string | null, sessionId = GATEWAY.sessionId, selfDeaf = true, selfMute = false): void => {
    methods?.onVoiceStateUpdate({
      guild_id: "guild",
      user_id: userId,
      channel_id: channelId,
      session_id: sessionId,
      self_deaf: selfDeaf,
      self_mute: selfMute,
    } as Parameters<DiscordGatewayAdapterLibraryMethods["onVoiceStateUpdate"]>[0]);
  };
  const server = (token = GATEWAY.token, endpoint: string | null = GATEWAY.endpoint): void => {
    methods?.onVoiceServerUpdate({ guild_id: "guild", token, endpoint });
  };
  const sendPayload = vi.fn(
    (payload: { d?: { channel_id?: string | null; self_deaf?: boolean; self_mute?: boolean } }) => {
      const channelId = payload.d?.channel_id;
      if (channelId)
        queueMicrotask(() => {
          state(channelId, GATEWAY.sessionId, payload.d?.self_deaf, payload.d?.self_mute);
          server();
        });
      return true;
    },
  );
  const destroy = vi.fn();
  const creator: DiscordGatewayAdapterCreator = bridge => {
    methods = bridge;
    return { sendPayload, destroy };
  };
  return { creator, sendPayload, destroy, state, server };
}

/** A Ready native state carrying `connectionOptions`, the only shape the session reads credentials from. */
export function readyState(gateway: Partial<typeof GATEWAY> = {}, channelId = CHANNEL): Record<string, unknown> {
  return { status: "ready", networking: { state: { connectionOptions: { ...GATEWAY, ...gateway, channelId } } } };
}

/** A native voice connection: state transitions are driven by the test, never by a real gateway. */
export class FakeConnection extends EventEmitter {
  state: Record<string, unknown> = readyState();
  joinConfig: { channelId: string | null } = { channelId: CHANNEL };
  readonly subscription: { readonly unsubscribe: Mock<() => void> } = { unsubscribe: vi.fn() };
  readonly subscribe: Mock<(_player: unknown) => { readonly unsubscribe: Mock<() => void> }> = vi.fn(
    (_player: unknown) => this.subscription,
  );
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

export interface FakeResource {
  /** The Opus packet stream the Player handed over. */
  readonly input: Readable;
  readonly inputType: unknown;
  playbackDuration: number;
}

/** Builds an AudioPlayer error that names the resource whose native work failed. */
export function audioPlayerError(
  resource: FakeResource,
  error = new Error("native audio player failed"),
): AudioPlayerError {
  return Object.assign(error, { resource }) as unknown as AudioPlayerError;
}

/** A native audio player whose state transitions carry the resource that just became idle. */
export class FakeAudioPlayer extends EventEmitter {
  state: { status: string; resource?: unknown } = { status: "idle" };
  readonly play = vi.fn((resource: unknown) => this.transition({ status: "playing", resource }));
  readonly pause = vi.fn(() => {
    this.transition({ ...this.state, status: "paused" });
    return true;
  });
  readonly unpause = vi.fn(() => {
    this.transition({ ...this.state, status: "playing" });
    return true;
  });
  readonly stop = vi.fn(() => {
    this.transition({ status: "idle" });
    return true;
  });

  transition(next: { status: string; resource?: unknown }): void {
    const previous = this.state;
    this.state = next;
    this.emit("stateChange", previous, next);
  }
}

export const native = {
  connections: [] as FakeConnection[],
  players: [] as FakeAudioPlayer[],
  resources: [] as FakeResource[],
  transports: [] as {
    state: ReturnType<typeof vi.fn>;
    server: ReturnType<typeof vi.fn>;
    sendPayload: (payload: unknown) => boolean;
  }[],

  entersState: vi.fn(async (_target: unknown, _status: string, _timeout: number) => undefined),
  joinVoiceChannel: vi.fn((options: { channelId: string; adapterCreator?: DiscordGatewayAdapterCreator }) => {
    if (options.adapterCreator) {
      const state = vi.fn();
      const server = vi.fn();
      const bridge = options.adapterCreator({
        onVoiceStateUpdate: state,
        onVoiceServerUpdate: server,
        destroy: vi.fn(),
      });
      native.transports.push({ state, server, sendPayload: bridge.sendPayload });
    }
    const connection = new FakeConnection();
    connection.joinConfig = { channelId: options.channelId };
    connection.state = readyState({}, options.channelId);
    native.connections.push(connection);
    return connection;
  }),
  createAudioPlayer: vi.fn(() => {
    const player = new FakeAudioPlayer();
    native.players.push(player);
    return player;
  }),
  createAudioResource: vi.fn((input: Readable, options?: { inputType?: unknown }) => {
    const resource: FakeResource = { input, inputType: options?.inputType, playbackDuration: 0 };
    const read = input.read.bind(input);
    input.read = (size?: number) => {
      const chunk: unknown = read(size);
      if (chunk !== null) resource.playbackDuration += 20;
      return chunk;
    };
    native.resources.push(resource);
    return resource;
  }),
};

/** The newest instance of each fake, which is the one a just-finished call produced. */
export const latest = {
  get connection(): FakeConnection {
    return native.connections.at(-1) as FakeConnection;
  },
  get player(): FakeAudioPlayer {
    return native.players.at(-1) as FakeAudioPlayer;
  },
  get resource(): FakeResource {
    return native.resources.at(-1) as FakeResource;
  },
};

export function resetNative(): void {
  // Resetting restores each fake's own implementation, so one test's override never leaks.
  vi.resetAllMocks();
  native.connections.length = 0;
  native.players.length = 0;
  native.resources.length = 0;
  native.transports.length = 0;
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
