import type {
  Adapter,
  Diagnostic,
  Engine,
  FilterDefinitionInfo,
  PlaybackResourceKind,
  PluginContext,
  PluginDataOf,
  ResolvableInput,
  SourceOperationOptions,
  SourcePlugin,
} from "./contracts";
import { isEngine, isSourcePlugin } from "./contracts";
import type { DisTubeQueue } from "./DisTubeQueue";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "./errors";
import {
  DisTubeEventEmitter,
  type DisTubeEventListener,
  type DisTubeEventName,
  type VoiceDisconnectReason,
} from "./events";
import type { Playlist, Song } from "./media";
import { throwIfAborted } from "./playback/abort";
import { resolveInput } from "./playback/resolve";
import { searchSongs, suggestQueries } from "./playback/search";
import { createSourceCatalog, type SourceCatalog } from "./playback/sources";
import { validateSourceName } from "./playback/validation";
import { type QueueCollection, QueueManager } from "./QueueManager";
import type { AddOptions } from "./queue/protocol";
import { settleAll } from "./utils/dispose";
import type { DisTubeVoice } from "./voice/DisTubeVoice";
import { type VoiceManager, VoiceManagerImpl } from "./voice/VoiceManager";

const DEFAULT_HISTORY_SIZE = 10;
const OPTION_KEYS = ["adapter", "sources", "engine", "historySize", "onDiagnostic"];

export interface DisTubeOptions<Target = VoiceChannelTarget> {
  readonly adapter: Adapter<Target>;
  readonly sources: readonly SourcePlugin[];
  readonly engine?: Engine;
  /** How many ended occurrences each queue remembers. Integer 0 or greater, default 10. */
  readonly historySize?: number;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void | Promise<void>;
}

export type { VoiceChannelTarget } from "./voice/target";

import { normalizeTarget, type VoiceChannelTarget } from "./voice/target";

export type PlayOptions<Metadata = unknown> = AddOptions<Metadata>;

/** Options for `distube.search`. `source` narrows the result type to that plugin's `PluginData`. */
export interface SearchRequest<Source extends SourcePlugin = SourcePlugin> extends SourceOperationOptions {
  readonly source?: Source;
  readonly limit?: number;
  readonly offset?: number;
}

type Lifecycle = Pick<SourcePlugin, "initialize" | "dispose"> & { readonly name?: string };

/**
 * The public client.
 *
 * `Metadata` names the shape of `options.metadata`, and threads to every QueueItem, DisTubeQueue, DisTubeVoice, and
 * event payload this client hands back, so those reads need no cast. It is a type-level contract only:
 * core never inspects the value, and omitting the parameter leaves every `metadata` typed `unknown`.
 */
export class DisTube<Metadata = unknown, Target = VoiceChannelTarget> {
  /** Guild voice presence, usable with or without a queue. */
  readonly voices: VoiceManager<Target>;
  readonly #plugins: readonly (Engine | SourcePlugin)[];
  readonly #events: DisTubeEventEmitter<Target>;
  readonly #voiceManager: VoiceManagerImpl<Target>;
  readonly #queues: QueueManager<Target>;
  readonly #sources: SourceCatalog;
  readonly #resolutions = new Map<AbortController, Promise<unknown>>();
  #shuttingDown = false;
  #shutdownPromise?: Promise<void>;

  constructor(options: DisTubeOptions<Target>) {
    const selectedEngine = this.#validateOptions(options);
    const engine = snapshotEngine(selectedEngine);
    const sources = Object.freeze([...options.sources]);
    const adapter = options.adapter;
    const diagnostic = options.onDiagnostic ?? (() => undefined);
    this.#events = new DisTubeEventEmitter<Target>(diagnostic);
    const integrations = [...new Set<Engine | SourcePlugin>([...sources, selectedEngine])];
    for (const integration of integrations) {
      if (ownedIntegrations.has(integration))
        throw new DisTubeError("INVALID_STATE", "Integration already belongs to a live client");
    }
    for (const integration of integrations) ownedIntegrations.add(integration);
    const entered: Lifecycle[] = [];
    try {
      for (const plugin of integrations as readonly Lifecycle[]) {
        entered.push(plugin);
        if (!plugin.initialize) continue;
        const result: unknown = (plugin.initialize as (context: PluginContext) => unknown)({
          diagnostic: record =>
            this.#events.report(Object.freeze({ ...record, ...(plugin.name ? { plugin: plugin.name } : {}) })),
        });
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch(error =>
            this.#events.report({
              severity: "error",
              stage: "plugin.initialize.late-rejection",
              message: `${plugin.name}.initialize rejected after returning an unsupported thenable`,
              ...(plugin.name ? { plugin: plugin.name } : {}),
              error: asError(error),
            }),
          );
          throw new Error(`${plugin.name}.initialize must be synchronous`);
        }
      }
    } catch (error: unknown) {
      const reportRollbackFailure = (plugin: Lifecycle, disposeError: unknown): void => {
        this.#events.report({
          severity: "error",
          stage: "plugin.initialize.rollback",
          message: `${plugin.name}.dispose failed during initialization rollback`,
          ...(plugin.name ? { plugin: plugin.name } : {}),
          error: asError(disposeError),
        });
      };
      const visited = new Set<unknown>(entered);
      const cleanup: Promise<unknown>[] = [];
      for (const plugin of [...entered].reverse()) {
        try {
          cleanup.push(
            Promise.resolve(plugin.dispose?.()).catch(disposeError => reportRollbackFailure(plugin, disposeError)),
          );
        } catch (disposeError: unknown) {
          reportRollbackFailure(plugin, disposeError);
        }
      }
      for (const integration of integrations) if (!visited.has(integration)) ownedIntegrations.delete(integration);
      void Promise.allSettled(cleanup).then(() => {
        for (const integration of entered) ownedIntegrations.delete(integration);
      });
      throw asDisTubeError(ErrorCode.PLUGIN_FAILED, "Integration initialization failed", error, { reclassify: true });
    }
    this.#plugins = Object.freeze(integrations);
    this.#sources = createSourceCatalog(sources);
    this.#voiceManager = new VoiceManagerImpl(adapter, engine, {
      events: this.#events,
      order: (guildId, work) => this.#queues.order(guildId, work),
      deleteQueue: (guildId, cause) => this.#queues.delete(guildId, cause),
      onDisconnected: (voice, reason, error) => this.#voiceDisconnected(voice, reason, error),
    });
    this.voices = this.#voiceManager.facade;
    // QueueManager owns guild-ordered play work; its closures keep internal DisTubeVoice capabilities private.
    this.#queues = new QueueManager(
      target => this.#voiceManager.joinInternal(target),
      guildId => this.#voiceManager.getInternal(guildId),
      guildId => this.#voiceManager.assertJoinable(guildId),
      this.#sources,
      this.#events,
      options.historySize ?? DEFAULT_HISTORY_SIZE,
      target => normalizeTarget(adapter, target),
    );
  }

  /** The public facade for QueueManager's private, per-guild play lane. */
  play(
    target: Target,
    input: ResolvableInput,
    options: PlayOptions<Metadata> = {},
  ): Promise<DisTubeQueue<Metadata, Target>> {
    return this.#queues.play(target, input, options) as Promise<DisTubeQueue<Metadata, Target>>;
  }

  /**
   * Resolves media through the configured SourcePlugins without touching queue or voice state.
   *
   * Disposal fences this the same way it fences play and join: once `dispose()` starts, the plugins are
   * on their way to `dispose()`, so a resolution begun now would outlive them.
   */
  resolve(input: ResolvableInput, options: SourceOperationOptions = {}): Promise<Song | Playlist> {
    return this.#fenced(options, signal => resolveInput(input, this.#sources, signal));
  }

  /**
   * Ranked results from one configured source, or the first non-empty result in constructor order.
   *
   * Passing a plugin instance as `source` types each result's `pluginData` by that plugin's declaration.
   */
  search<Source extends SourcePlugin>(
    query: string,
    options: SearchRequest<Source> & { readonly source: Source },
  ): Promise<readonly Song<PluginDataOf<Source>>[]>;
  search(query: string, options?: SearchRequest): Promise<readonly Song[]>;
  search(query: string, options: SearchRequest = {}): Promise<readonly Song[]> {
    try {
      validateQuery(query);
      this.#validateSource(options.source);
      if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1))
        throw new DisTubeError("INVALID_ARGUMENT", "limit must be a positive integer");
      if (options.offset !== undefined && (!Number.isInteger(options.offset) || options.offset < 0))
        throw new DisTubeError("INVALID_ARGUMENT", "offset must be a non-negative integer");
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#fenced(options, signal => searchSongs(query, this.#sources, options, signal));
  }

  /** Provider completions for a partial query; a source without `suggest` declines with an empty list. */
  getSuggestions(
    query: string,
    source?: SourcePlugin,
    options: SourceOperationOptions = {},
  ): Promise<readonly string[]> {
    try {
      validateQuery(query);
      this.#validateSource(source);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    return this.#fenced(options, signal => suggestQueries(query, this.#sources, source, signal));
  }

  /** The guild's live DisTubeQueue, or `undefined` once it has been deleted. */
  getQueue(guildId: string): DisTubeQueue<Metadata, Target> | undefined {
    return this.#queues.get(guildId) as DisTubeQueue<Metadata, Target> | undefined;
  }

  get queues(): QueueCollection<Metadata, Target> {
    return this.#queues.view as QueueCollection<Metadata, Target>;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata, Target>): () => void {
    return this.#events.on(name, listener as DisTubeEventListener<Name, unknown, Target>);
  }

  dispose(): Promise<void> {
    if (!this.#shutdownPromise) {
      this.#shuttingDown = true;
      this.#fenceResolutions();
      this.#shutdownPromise = this.#performShutdown();
    }
    return this.#shutdownPromise;
  }

  /** Runs one source operation under the disposal fence and the caller's signal, never inline. */
  #fenced<Value>(options: SourceOperationOptions, operation: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
    if (this.#shuttingDown) return Promise.reject(this.#shutdownError());
    if (
      !options ||
      typeof options !== "object" ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    ) {
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", "Invalid source operation options"));
    }
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const run = Promise.resolve().then(async () => {
      try {
        throwIfAborted(signal);
        const value = await operation(signal);
        if (this.#shuttingDown) throw this.#shutdownError();
        throwIfAborted(signal);
        return value;
      } catch (error: unknown) {
        if (this.#shuttingDown) throw this.#shutdownError();
        throw error;
      } finally {
        this.#resolutions.delete(controller);
      }
    });
    this.#resolutions.set(controller, run);
    return run;
  }

  #validateSource(source: SourcePlugin | undefined): void {
    if (source === undefined) return;
    if (!this.#sources.ordered.includes(source))
      throw new DisTubeError("INVALID_ARGUMENT", "source must be a SourcePlugin configured on this client");
  }

  async #performShutdown(): Promise<void> {
    this.#queues.fence();
    this.#voiceManager.fence();
    const queueFailures = await this.#queues.deleteAll({ kind: "shutdown" });
    const voiceFailures = await this.#voiceManager.releaseAll();
    await Promise.allSettled([...this.#resolutions.values()]);
    const pluginFailures = await settleAll(
      [...(this.#plugins as readonly Lifecycle[])].reverse().map(plugin => () => plugin.dispose?.()),
    );
    for (const integration of this.#plugins) ownedIntegrations.delete(integration);
    const failures = [
      ...queueFailures.flatMap(cleanupCauses),
      ...voiceFailures.flatMap(cleanupCauses),
      ...pluginFailures.flatMap(cleanupCauses),
    ];
    if (failures.length > 0) {
      throw new DisTubeError(
        queueFailures.length > 0
          ? ErrorCode.QUEUE_FAILED
          : voiceFailures.length > 0
            ? ErrorCode.VOICE_FAILED
            : ErrorCode.PLUGIN_FAILED,
        "DisTube shutdown cleanup failed",
        { cause: new AggregateError(failures, "DisTube shutdown cleanup failures") },
      );
    }
  }

  #fenceResolutions(): void {
    for (const controller of this.#resolutions.keys()) controller.abort(this.#shutdownError());
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError("INVALID_STATE", "DisTube is disposed");
  }

  #voiceDisconnected(voice: DisTubeVoice<Target>, reason: VoiceDisconnectReason, error?: Error): void {
    this.#events.emit(
      "voice.disconnected",
      Object.freeze({
        guildId: voice.guildId,
        voice,
        channelId: voice.channelId,
        timestamp: Date.now(),
        reason,
        ...(error
          ? { error: asDisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice disconnected terminally", error) }
          : {}),
      }),
    );
  }

  #validateOptions(options: DisTubeOptions<Target>): Engine {
    if (!options || typeof options !== "object")
      throw new DisTubeError("INVALID_ARGUMENT", "DisTube options are required");
    if (Object.keys(options).some(key => !OPTION_KEYS.includes(key))) {
      throw new DisTubeError("INVALID_ARGUMENT", "Unknown DisTube option");
    }
    if (
      !options.adapter ||
      typeof options.adapter.createVoiceSession !== "function" ||
      typeof options.adapter.normalizeTarget !== "function"
    ) {
      throw new DisTubeError("INVALID_ARGUMENT", "options.adapter must implement Adapter");
    }
    if (!Array.isArray(options.sources)) throw new DisTubeError("INVALID_ARGUMENT", "options.sources must be an array");
    const names = new Set<string>();
    const seen = new Set<SourcePlugin>();
    for (const source of options.sources) {
      if (!isSourcePlugin(source))
        throw new DisTubeError("INVALID_ARGUMENT", "Each source must implement SourcePlugin");
      assertOptionalHooks(source, "SourcePlugin");
      validateSourceName(source.name);
      if (names.has(source.name)) throw new DisTubeError("INVALID_ARGUMENT", "Duplicate source name");
      if (seen.has(source)) throw new DisTubeError("INVALID_ARGUMENT", "Duplicate source instance");
      names.add(source.name);
      seen.add(source);
    }
    const engine = options.engine ?? options.adapter.engine;
    if (!isEngine(engine)) throw new DisTubeError("INVALID_ARGUMENT", "options.engine must implement Engine");
    if (engine.name !== undefined) {
      validateSourceName(engine.name, "Engine name");
      if (options.sources.some(source => source.name === engine.name && source !== engine)) {
        throw new DisTubeError("INVALID_ARGUMENT", "Distinct source and engine instances cannot share a name");
      }
    }
    assertOptionalHooks(engine, "Engine");
    if (options.historySize !== undefined && (!Number.isInteger(options.historySize) || options.historySize < 0)) {
      throw new DisTubeError("INVALID_ARGUMENT", "historySize must be an integer of 0 or greater");
    }
    if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function") {
      throw new DisTubeError("INVALID_ARGUMENT", "onDiagnostic must be a function");
    }
    return engine;
  }
}

/** Optional hooks may be absent, but a present hook must be callable. */
function assertOptionalHooks(plugin: Lifecycle, label: string): void {
  if (
    (plugin.initialize !== undefined && typeof plugin.initialize !== "function") ||
    (plugin.dispose !== undefined && typeof plugin.dispose !== "function")
  ) {
    throw new DisTubeError("INVALID_ARGUMENT", `${label} initialize and dispose must be functions when present`);
  }
}

function validateQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0)
    throw new DisTubeError("INVALID_ARGUMENT", "query must be a non-empty string");
}

function cleanupCauses(error: Error): readonly Error[] {
  if (!(error instanceof DisTubeError)) return [error];
  if (error.cause instanceof AggregateError) {
    return error.cause.errors.flatMap((cause: unknown) => cleanupCauses(asError(cause)));
  }
  return error.cause instanceof Error ? cleanupCauses(error.cause) : [error];
}

const ownedIntegrations = new WeakSet<object>();

/** Capture configuration before hooks run while preserving the selected integration's method receiver. */
function snapshotEngine(engine: Engine): Engine {
  try {
    const kinds = new Set<PlaybackResourceKind>(["url", "file", "stream", "encoded"]);
    const accepts = new Set(engine.accepts);
    if (accepts.size === 0 || [...accepts].some(kind => !kinds.has(kind))) {
      throw new DisTubeError("INVALID_ARGUMENT", "Engine accepts must contain supported resource kinds");
    }
    const encodedFormats = new Set(engine.encodedFormats ?? []);
    if (
      (accepts.has("encoded") && encodedFormats.size === 0) ||
      [...encodedFormats].some(format => typeof format !== "string" || format.trim().length === 0)
    ) {
      throw new DisTubeError("INVALID_ARGUMENT", "Encoded engines must declare non-empty format identifiers");
    }
    const filters = new Map<string, FilterDefinitionInfo>();
    for (const [name, definition] of engine.filters) {
      if (
        typeof name !== "string" ||
        name.trim().length === 0 ||
        !definition ||
        typeof definition !== "object" ||
        typeof definition.label !== "function" ||
        typeof definition.acceptsValue !== "boolean" ||
        [definition.default, definition.min, definition.max].some(
          value => value !== undefined && !Number.isFinite(value),
        ) ||
        (definition.min !== undefined && definition.max !== undefined && definition.min > definition.max)
      ) {
        throw new DisTubeError("INVALID_ARGUMENT", "Engine filters must contain valid preset definitions");
      }
      filters.set(name, Object.freeze({ ...definition, label: definition.label.bind(definition) }));
    }
    return Object.freeze({
      accepts,
      encodedFormats,
      filters,
      capabilities: Object.freeze({ seek: engine.capabilities.seek }),
      ...(engine.supportsResource ? { supportsResource: engine.supportsResource.bind(engine) } : {}),
      createPlayer: engine.createPlayer.bind(engine),
    });
  } catch (error) {
    if (DisTubeError.is(error, "INVALID_ARGUMENT")) throw error;
    throw new DisTubeError("INVALID_ARGUMENT", "Engine configuration collections are invalid", {
      cause: asError(error),
    });
  }
}
