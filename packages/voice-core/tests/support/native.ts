import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import type {
  AudioPlayerError,
  DiscordGatewayAdapterCreator,
  DiscordGatewayAdapterLibraryMethods,
} from "@discordjs/voice";
import { type Mock, vi } from "vitest";

export function noPlatform(): never {
  throw new Error("This test opens its voice session directly");
}

export const GATEWAY = { channelId: "channel", sessionId: "session", token: "token", endpoint: "voice.example" };

export const CHANNEL = "channel";

export function gatewayAdapter(
  userId = "bot",
  endpoint = GATEWAY.endpoint,
): {
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
  const server = (token = GATEWAY.token, at: string | null = endpoint): void => {
    methods?.onVoiceServerUpdate({ guild_id: "guild", token, endpoint: at });
  };
  let joined: { channelId: string; selfDeaf?: boolean; selfMute?: boolean } | undefined;
  const sendPayload = vi.fn(
    (payload: { d?: { channel_id?: string | null; self_deaf?: boolean; self_mute?: boolean } }) => {
      const channelId = payload.d?.channel_id;
      const selfDeaf = payload.d?.self_deaf;
      const selfMute = payload.d?.self_mute;
      if (channelId) {
        const held = joined?.channelId === channelId;
        joined = { channelId, selfDeaf, selfMute };
        queueMicrotask(() => {
          state(channelId, GATEWAY.sessionId, selfDeaf, selfMute);
          if (!held) server();
        });
      } else if (channelId === null && joined) {
        joined = undefined;
        queueMicrotask(() => state(null, GATEWAY.sessionId, selfDeaf, selfMute));
      }
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

export function readyState(gateway: Partial<typeof GATEWAY> = {}, channelId = CHANNEL): Record<string, unknown> {
  const networking = Object.assign(new EventEmitter(), {
    state: { connectionOptions: { ...GATEWAY, ...gateway, channelId } },
  });
  return { status: "ready", networking };
}

export class FakeConnection extends EventEmitter {
  state: Record<string, unknown> = readyState();
  joinConfig: { channelId: string | null; selfDeaf: boolean; selfMute: boolean } = {
    channelId: CHANNEL,
    selfDeaf: true,
    selfMute: false,
  };
  readonly subscription: { readonly unsubscribe: Mock<() => void> } = { unsubscribe: vi.fn() };
  readonly subscribe: Mock<(_player: unknown) => { readonly unsubscribe: Mock<() => void> }> = vi.fn(
    (_player: unknown) => this.subscription,
  );
  readonly rejoin = vi.fn((config: { channelId: string; selfDeaf?: boolean; selfMute?: boolean }) => {
    Object.assign(this.joinConfig, config);
    const { adapter } = this.state as { adapter?: { sendPayload(payload: unknown): boolean } };
    return (
      adapter?.sendPayload({
        op: 4,
        d: {
          guild_id: "guild",
          channel_id: this.joinConfig.channelId,
          self_deaf: this.joinConfig.selfDeaf,
          self_mute: this.joinConfig.selfMute,
        },
      }) ?? true
    );
  });
  readonly destroy = vi.fn(() => this.transition({ status: "destroyed" }));

  transition(next: Record<string, unknown>): void {
    const previous = this.state;
    this.state = next;
    this.emit("stateChange", previous, next);
  }
}

export interface FakeResource {
  readonly input: Readable;
  readonly inputType: unknown;
  playbackDuration: number;
}

export function audioPlayerError(
  resource: FakeResource,
  error = new Error("native audio player failed"),
): AudioPlayerError {
  return Object.assign(error, { resource }) as unknown as AudioPlayerError;
}

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
  joinVoiceChannel: vi.fn(
    (options: {
      channelId: string;
      selfDeaf?: boolean;
      selfMute?: boolean;
      adapterCreator?: DiscordGatewayAdapterCreator;
    }) => {
      const connection = new FakeConnection();
      let adapter: ReturnType<DiscordGatewayAdapterCreator> | undefined;
      if (options.adapterCreator) {
        const state = vi.fn((packet: { channel_id: string | null; self_deaf: boolean; self_mute: boolean }) => {
          if (packet.channel_id) connection.joinConfig.channelId = packet.channel_id;
          connection.joinConfig.selfDeaf = packet.self_deaf;
          connection.joinConfig.selfMute = packet.self_mute;
        });
        const server = vi.fn((packet: { token: string }) =>
          connection.transition({
            ...readyState({ token: packet.token }, connection.joinConfig.channelId ?? CHANNEL),
            adapter,
          }),
        );
        adapter = options.adapterCreator({
          onVoiceStateUpdate: state,
          onVoiceServerUpdate: server,
          destroy: vi.fn(),
        });
        native.transports.push({ state, server, sendPayload: adapter.sendPayload });
      }
      connection.joinConfig = {
        channelId: options.channelId,
        selfDeaf: options.selfDeaf ?? true,
        selfMute: options.selfMute ?? false,
      };
      connection.state = { ...readyState({}, options.channelId), adapter };
      native.connections.push(connection);
      return connection;
    },
  ),
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
  vi.resetAllMocks();
  native.connections.length = 0;
  native.players.length = 0;
  native.resources.length = 0;
  native.transports.length = 0;
}

export function settle(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

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
