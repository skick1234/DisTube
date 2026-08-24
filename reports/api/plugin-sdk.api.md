# plugin-sdk public API

```ts
//#region ../types/src/index.d.ts
type Awaitable<T> = T | PromiseLike<T>;
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
type VoiceDisconnectReason = "left" | "moved" | "remote" | "destroyed" | "failed";
type FilterMap = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
//#endregion
//#region ../utils/src/index.d.ts
declare function throwIfAborted(signal: AbortSignal | undefined, operation?: string): void;
declare function safeUrl(input: string, protocols?: readonly string[]): URL;
//#endregion
//#region src/index.d.ts
declare const PLUGIN_CONTRACT_VERSION: 1;
declare const PLUGIN_DEFINITION: "@distube/plugin-definition/v1";
type PluginRole = "adapter" | "voice" | "source" | "utility";
type AdapterCapability = "guild-id" | "voice-channel";
type VoiceCapability = "move" | "pause" | "resume" | "seek" | "volume" | "filters";
type SourceCapability = "resolve" | "related" | "search";
type UtilityCapability = string;
type CapabilitiesFor<Role extends PluginRole> = Role extends "adapter" ? AdapterCapability : Role extends "voice" ? VoiceCapability : Role extends "source" ? SourceCapability : UtilityCapability;
interface PluginManifest<Role extends PluginRole = PluginRole> {
  readonly id: string;
  readonly version: string;
  readonly contractVersion: typeof PLUGIN_CONTRACT_VERSION;
  readonly role: Role;
  readonly capabilities: readonly CapabilitiesFor<Role>[];
  readonly requires?: Readonly<{
    adapter?: readonly AdapterCapability[];
  }>;
}
interface DiagnosticRecord {
  readonly pluginId: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}
interface OwnedResource {
  readonly name: string;
  dispose(): Awaitable<void>;
}
interface ResourceOwner {
  register(resource: OwnedResource): void;
  transfer(resource: OwnedResource, target: ResourceOwner): void;
}
interface PluginContext {
  readonly pluginId: string;
  readonly signal: AbortSignal;
  readonly clock: Readonly<{
    now(): number;
  }>;
  readonly scheduler: Readonly<{
    queue(task: () => Awaitable<void>): void;
  }>;
  readonly resources: ResourceOwner;
  diagnose(record: Omit<DiagnosticRecord, "pluginId">): void;
}
interface PluginInstance {
  initialize?(context: PluginContext): Awaitable<void>;
  dispose(): Awaitable<void>;
}
interface NormalizedVoiceChannel {
  readonly guildId: string;
  readonly channelId: string;
}
interface AdapterPlugin extends PluginInstance {
  normalizeGuildId(input: unknown): string;
  normalizeVoiceChannel(input: unknown, signal: AbortSignal): Awaitable<NormalizedVoiceChannel>;
}
interface VoiceNotification {
  readonly type: "ended" | "error" | "disconnected";
  readonly playbackId?: string;
  readonly error?: unknown;
  readonly reason?: VoiceDisconnectReason;
}
interface VoiceConnection {
  readonly value: unknown;
}
interface PreparedPlayback {
  readonly value: unknown;
  readonly resources?: readonly OwnedResource[];
}
interface VoicePlugin extends PluginInstance {
  connect(channel: NormalizedVoiceChannel, notify: (notification: VoiceNotification) => void, signal: AbortSignal): Awaitable<VoiceConnection>;
  move?(connection: VoiceConnection, channel: NormalizedVoiceChannel, signal: AbortSignal): Awaitable<void>;
  leave(connection: VoiceConnection, signal: AbortSignal): Awaitable<void>;
  prepare(song: Song<unknown>, source: SourceResource | undefined, signal: AbortSignal): Awaitable<PreparedPlayback>;
  activate(connection: VoiceConnection, prepared: PreparedPlayback, playbackId: string, signal: AbortSignal): Awaitable<void>;
  stop(connection: VoiceConnection, signal: AbortSignal): Awaitable<void>;
  pause?(connection: VoiceConnection, signal: AbortSignal): Awaitable<void>;
  resume?(connection: VoiceConnection, signal: AbortSignal): Awaitable<void>;
  seek?(connection: VoiceConnection, seconds: number, signal: AbortSignal): Awaitable<void>;
  setVolume?(connection: VoiceConnection, volume: number, signal: AbortSignal): Awaitable<void>;
  applyFilters?(connection: VoiceConnection, filters: FilterMap, signal: AbortSignal): Awaitable<void>;
}
interface SourceResource extends OwnedResource {
  readonly value: unknown;
}
interface ResolveContext {
  readonly signal: AbortSignal;
}
type ResolveResult = readonly Song<unknown>[] | undefined;
interface SourcePlugin extends PluginInstance {
  resolve(input: unknown, context: ResolveContext): Awaitable<ResolveResult>;
  related?(item: QueueItem<unknown, unknown>, context: ResolveContext): Awaitable<Song<unknown> | undefined>;
  search?(query: string, context: ResolveContext): Awaitable<readonly Song<unknown>[]>;
  createResource?(song: Song<unknown>, context: ResolveContext): Awaitable<SourceResource | undefined>;
}
interface UtilityPlugin extends PluginInstance {}
type RoleInstance<Role extends PluginRole> = Role extends "adapter" ? AdapterPlugin : Role extends "voice" ? VoicePlugin : Role extends "source" ? SourcePlugin : UtilityPlugin;
interface PluginClass<Instance extends PluginInstance = PluginInstance, Options = unknown, Role extends PluginRole = PluginRole> {
  readonly manifest: PluginManifest<Role>;
  define(options: Options): PluginDefinition<Instance, Role>;
}
interface PluginDefinition<Instance extends PluginInstance = PluginInstance, Role extends PluginRole = PluginRole> {
  readonly [PLUGIN_DEFINITION]: true;
  readonly pluginClass: PluginClass<Instance, unknown, Role>;
  readonly manifest: PluginManifest<Role>;
  readonly options: Readonly<unknown>;
  create(): Instance;
}
declare function definePlugin<Instance extends RoleInstance<Role>, Options, Role extends PluginRole>(config: {
  readonly pluginClass: PluginClass<Instance, Options, Role>;
  readonly options: Options;
  readonly normalize?: (options: Options) => Readonly<Options>;
  readonly create: (options: Readonly<Options>) => Instance;
}): PluginDefinition<Instance, Role>;
declare function validateManifest<Role extends PluginRole>(manifest: PluginManifest<Role>): PluginManifest<Role>;
declare function pluginTokenId(token: Pick<PluginClass, "manifest">): string;
declare function isPluginDefinition(value: unknown): value is PluginDefinition;
//#endregion
export { AdapterCapability, AdapterPlugin, type Awaitable, CapabilitiesFor, DiagnosticRecord, DisTubeError, type FilterMap, NormalizedVoiceChannel, OwnedResource, PLUGIN_CONTRACT_VERSION, PLUGIN_DEFINITION, PluginClass, PluginContext, PluginDefinition, PluginInstance, PluginManifest, PluginRole, PreparedPlayback, QueueItem, ResolveContext, ResolveResult, ResourceOwner, RoleInstance, Song, SourceCapability, SourcePlugin, SourceResource, UtilityCapability, UtilityPlugin, VoiceCapability, VoiceConnection, VoiceNotification, VoicePlugin, definePlugin, isPluginDefinition, pluginTokenId, safeUrl, throwIfAborted, validateManifest };
//# sourceMappingURL=index.d.mts.map
```
