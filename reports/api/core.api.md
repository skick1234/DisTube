# core public API

```ts
import { AdapterPlugin, DiagnosticRecord, PluginClass, PluginDefinition, PluginInstance, SourcePlugin, VoicePlugin } from "@distube/plugin-sdk";
//#region ../types/src/index.d.ts
interface SongData<Metadata = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly source: string;
  readonly url?: string;
  readonly thumbnail?: string;
  readonly isLive?: boolean;
  readonly metadata?: Metadata;
}
/** Immutable provider-neutral media identity. */
declare class Song<Metadata = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly title: string;
  readonly duration: number;
  readonly source: string;
  readonly url?: string;
  readonly thumbnail?: string;
  readonly isLive: boolean;
  static [Symbol.hasInstance](value: unknown): boolean;
  constructor(data: SongData<Metadata>);
  get metadata(): Metadata;
  toString(): string;
}
interface QueueItemData<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  readonly id?: string;
  readonly song: Song<Metadata>;
  readonly requestedBy?: unknown;
  readonly addedAt?: Date;
  readonly context?: Context;
}
/** Immutable occurrence of a Song in one guild queue. */
declare class QueueItem<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  readonly id: string;
  readonly song: Song<Metadata>;
  readonly requestedBy?: unknown;
  static [Symbol.hasInstance](value: unknown): boolean;
  constructor(data: QueueItemData<Metadata, Context>);
  get addedAt(): Date;
  get context(): Context | undefined;
}
type RepeatMode = "off" | "song" | "queue";
type PlaybackStatus = "idle" | "preparing" | "playing" | "paused";
type VoiceState = Readonly<{
  status: "disconnected";
}> | Readonly<{
  status: "connected";
  guildId: string;
  channelId: string;
}>;
interface GuildQueueSnapshot<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  readonly guildId: string;
  readonly revision: number;
  readonly current?: QueueItem<Metadata, Context>;
  readonly upcoming: readonly QueueItem<Metadata, Context>[];
  readonly history: readonly QueueItem<Metadata, Context>[];
  readonly status: PlaybackStatus;
  readonly paused: boolean;
  readonly volume: number;
  readonly repeatMode: RepeatMode;
  readonly autoplay: boolean;
  readonly filters: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly currentTime: number;
  readonly duration: number;
  readonly voice: VoiceState;
  readonly destroyed: boolean;
}
declare const DISTUBE_ERROR_CODES: readonly ["INVALID_INPUT", "PLUGIN_FAILED", "SOURCE_NOT_FOUND", "VOICE_NOT_CONNECTED", "CAPABILITY_UNSUPPORTED", "TIMEOUT", "ABORTED", "RUNTIME_DESTROYED"];
type DisTubeErrorCode = (typeof DISTUBE_ERROR_CODES)[number];
interface DisTubeErrorDetailsMap {
  INVALID_INPUT: {
    readonly operation?: string;
    readonly path?: string;
    readonly reason?: string;
    readonly value?: unknown;
  };
  PLUGIN_FAILED: {
    readonly pluginId?: string;
    readonly role?: string;
    readonly phase?: string;
    readonly operation?: string;
  };
  SOURCE_NOT_FOUND: {
    readonly input?: unknown;
  };
  VOICE_NOT_CONNECTED: {
    readonly guildId: string;
    readonly operation?: string;
  };
  CAPABILITY_UNSUPPORTED: {
    readonly pluginId?: string;
    readonly capability: string;
    readonly operation?: string;
    readonly requiredBy?: string;
  };
  TIMEOUT: {
    readonly operation: string;
    readonly timeoutMs: number;
  };
  ABORTED: {
    readonly operation?: string;
  };
  RUNTIME_DESTROYED: {
    readonly guildId?: string;
    readonly operation?: string;
  };
}
declare class DisTubeError<Code extends DisTubeErrorCode = DisTubeErrorCode> extends Error {
  readonly code: Code;
  readonly details: Readonly<DisTubeErrorDetailsMap[Code]>;
  constructor(code: Code, details: DisTubeErrorDetailsMap[Code], options?: ErrorOptions);
}
interface CleanupFailure {
  readonly resource: string;
  readonly error: Error;
}
type CleanupOutcome = Readonly<{
  resource: string;
  status: "success";
}> | Readonly<{
  resource: string;
  status: "failure";
  error: Error;
}> | Readonly<{
  resource: string;
  status: "timeout";
  timeoutMs: number;
}>;
interface DestroyReport {
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly outcomes: readonly CleanupOutcome[];
  readonly failures: readonly CleanupFailure[];
  readonly timedOut: readonly string[];
}
type SongEndReason = "natural" | "replaced" | "skipped" | "stopped" | "failed";
type QueueEmptyReason = "exhausted" | "stopped" | "failed";
type VoiceDisconnectReason = "left" | "moved" | "remote" | "destroyed" | "failed";
interface GuildQueueEventMap<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  queueCreated: Readonly<{
    queue: unknown;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  songAdded: Readonly<{
    queue: unknown;
    item: QueueItem<Metadata, Context>;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  songStart: Readonly<{
    queue: unknown;
    item: QueueItem<Metadata, Context>;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  songEnd: Readonly<{
    queue: unknown;
    item: QueueItem<Metadata, Context>;
    reason: SongEndReason;
    error?: DisTubeError;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  queueEmpty: Readonly<{
    queue: unknown;
    reason: QueueEmptyReason;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  voiceConnected: Readonly<{
    queue: unknown;
    voice: Extract<VoiceState, {
      status: "connected";
    }>;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  voiceDisconnected: Readonly<{
    queue: unknown;
    reason: VoiceDisconnectReason;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  error: Readonly<{
    queue: unknown;
    error: DisTubeError;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
  destroyed: Readonly<{
    queue: unknown;
    snapshot: GuildQueueSnapshot<Metadata, Context>;
  }>;
}
type MoveTarget = Readonly<{
  position: "start" | "end";
}> | Readonly<{
  position: "before" | "after";
  itemId: string;
}>;
interface QueueCommandOptions<Context = unknown> {
  readonly requestedBy?: unknown;
  readonly context?: Context;
  readonly signal?: AbortSignal;
}
type FilterMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
//#endregion
//#region src/runtime/PublicRuntimeTypes.d.ts
interface ListenerErrorContext {
  readonly event: string;
  readonly guildId: string;
}
interface DisTubeOptions {
  readonly plugins: readonly PluginDefinition[];
  readonly cleanupTimeoutMs?: number;
  readonly historyLimit?: number;
  readonly onDiagnostic?: (record: DiagnosticRecord) => void;
  readonly onListenerError?: (error: unknown, context: ListenerErrorContext) => void;
}
//#endregion
//#region src/resources/CleanupPlan.d.ts
interface CleanupUnit {
  readonly name: string;
  readonly deadlineMs?: number;
  readonly run: () => void | PromiseLike<void>;
}
//#endregion
//#region src/v6/PluginRegistry.d.ts
interface RegistryOptions {
  readonly cleanupTimeoutMs: number;
  readonly diagnose?: (record: DiagnosticRecord) => void;
}
declare class PluginRegistry {
  #private;
  readonly adapter: AdapterPlugin;
  readonly voice: VoicePlugin;
  readonly sources: readonly SourcePlugin[];
  private constructor();
  static create(definitions: readonly PluginDefinition[], options: RegistryOptions): Promise<PluginRegistry>;
  get<Instance extends PluginInstance>(pluginClass: PluginClass<Instance>): Instance | undefined;
  sourceFor(id: string): SourcePlugin | undefined;
  capabilities(id: string): readonly string[];
  abort(reason?: unknown): void;
  dispose(): Promise<Error[]>;
  cleanupUnits(): readonly CleanupUnit[];
}
//#endregion
//#region src/session/GuildSession.d.ts
type GuildSessionEventMap<Metadata, Context> = { [Event in keyof GuildQueueEventMap<Metadata, Context>]: Omit<GuildQueueEventMap<Metadata, Context>[Event], "queue">; };
//#endregion
//#region src/v6/GuildQueue.d.ts
type Listener<Event> = (event: Event) => unknown;
interface GuildQueueSession<Metadata, Context> {
  play(input: unknown, options?: QueueCommandOptions<Context>): Promise<QueueItem<Metadata, Context>>;
  add(input: unknown, options?: QueueCommandOptions<Context>): Promise<readonly QueueItem<Metadata, Context>[]>;
  join(channel: unknown, signal?: AbortSignal): Promise<void>;
  moveVoice(channel: unknown, signal?: AbortSignal): Promise<void>;
  leave(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  skip(signal?: AbortSignal): Promise<QueueItem<Metadata, Context>>;
  previous(signal?: AbortSignal): Promise<QueueItem<Metadata, Context>>;
  setPaused(paused: boolean, signal?: AbortSignal): Promise<void>;
  seek(seconds: number, signal?: AbortSignal): Promise<void>;
  setVolume(volume: number, signal?: AbortSignal): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<void>;
  setAutoplay(enabled: boolean): Promise<void>;
  setFilters(filters: FilterMap, signal?: AbortSignal): Promise<void>;
  remove(itemId: string): Promise<QueueItem<Metadata, Context>>;
  move(itemId: string, target: MoveTarget): Promise<void>;
}
interface GuildQueueController<Metadata, Context> {
  snapshot(): GuildQueueSnapshot<Metadata, Context>;
  session(): GuildQueueSession<Metadata, Context>;
  destroy(): Promise<void>;
  schedulePublication(task: () => void): void;
  listenerError(error: unknown, event: PropertyKey): void;
}
/** Stable public facade over the current private guild session. */
declare class GuildQueue<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  #private;
  readonly guildId: string;
  /** @internal */
  constructor(guildId: string, controller: GuildQueueController<Metadata, Context>);
  get current(): QueueItem<Metadata, Context> | undefined;
  get upcoming(): readonly QueueItem<Metadata, Context>[];
  get history(): readonly QueueItem<Metadata, Context>[];
  get paused(): boolean;
  get volume(): number;
  get repeatMode(): RepeatMode;
  get autoplay(): boolean;
  get filters(): FilterMap;
  get currentTime(): number;
  get voice(): VoiceState;
  get status(): GuildQueueSnapshot<Metadata, Context>["status"];
  snapshot(): GuildQueueSnapshot<Metadata, Context>;
  on<Event extends keyof GuildQueueEventMap<Metadata, Context>>(event: Event, listener: Listener<GuildQueueEventMap<Metadata, Context>[Event]>): this;
  off<Event extends keyof GuildQueueEventMap<Metadata, Context>>(event: Event, listener: Listener<GuildQueueEventMap<Metadata, Context>[Event]>): this;
  play(input: unknown, options?: QueueCommandOptions<Context>): Promise<QueueItem<Metadata, Context>>;
  add(input: unknown, options?: QueueCommandOptions<Context>): Promise<readonly QueueItem<Metadata, Context>[]>;
  join(channel: unknown, signal?: AbortSignal): Promise<this>;
  moveVoice(channel: unknown, signal?: AbortSignal): Promise<this>;
  leave(signal?: AbortSignal): Promise<void>;
  stop(signal?: AbortSignal): Promise<void>;
  skip(signal?: AbortSignal): Promise<QueueItem<Metadata, Context>>;
  previous(signal?: AbortSignal): Promise<QueueItem<Metadata, Context>>;
  pause(signal?: AbortSignal): Promise<this>;
  resume(signal?: AbortSignal): Promise<this>;
  seek(seconds: number, signal?: AbortSignal): Promise<this>;
  setVolume(volume: number, signal?: AbortSignal): Promise<this>;
  setRepeatMode(mode: RepeatMode): Promise<this>;
  setAutoplay(enabled: boolean): Promise<this>;
  setFilters(filters: FilterMap, signal?: AbortSignal): Promise<this>;
  remove(itemId: string): Promise<QueueItem<Metadata, Context>>;
  move(itemId: string, target: MoveTarget): Promise<this>;
  /** @internal */
  destroy(): Promise<void>;
  /** @internal */
  publish<Event extends keyof GuildSessionEventMap<Metadata, Context>>(event: Event, payload: GuildSessionEventMap<Metadata, Context>[Event]): void;
}
//#endregion
//#region src/DisTube.d.ts
declare class DisTube<Metadata = Readonly<Record<string, unknown>>, Context = unknown> {
  #private;
  private constructor();
  static create<Metadata = Readonly<Record<string, unknown>>, Context = unknown>(options: DisTubeOptions): Promise<DisTube<Metadata, Context>>;
  static get version(): string;
  get version(): string;
  get plugins(): PluginRegistry;
  get historyLimit(): number;
  get destroying(): boolean;
  /** @internal */
  get pluginRegistry(): PluginRegistry;
  queue(guild: unknown): GuildQueue<Metadata, Context>;
  play(channel: unknown, input: unknown, options?: QueueCommandOptions<Context>): Promise<GuildQueue<Metadata, Context>>;
  destroy(): Promise<DestroyReport>;
}
//#endregion
export { type CleanupFailure, type CleanupOutcome, DISTUBE_ERROR_CODES, type DestroyReport, DisTube, DisTubeError, type DisTubeErrorCode, type DisTubeErrorDetailsMap, type DisTubeOptions, type FilterMap, GuildQueue, type GuildQueueEventMap, type GuildQueueSnapshot, type ListenerErrorContext, type MoveTarget, type PlaybackStatus, type QueueCommandOptions, type QueueEmptyReason, QueueItem, type QueueItemData, type RepeatMode, Song, type SongData, type SongEndReason, type VoiceDisconnectReason, type VoiceState };
//# sourceMappingURL=index.d.mts.map
```
