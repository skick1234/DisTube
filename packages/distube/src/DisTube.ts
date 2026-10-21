import type {
  Adapter,
  Diagnostic,
  Engine,
  FilterDefinitions,
  Plugin,
  PluginDataOf,
  ResolvableInput,
} from "./contracts";
import { type AddOptions, DisTubeQueue, queueControl } from "./DisTubeQueue";
import { DisTubeError, ErrorCode, requireBoolean, throwIfAborted } from "./errors";
import { DisTubeEvents, type DisTubeEventListener, type DisTubeEventName } from "./events";
import { Playlist, type QueueItem, Song } from "./media";
import { ownerOf, resolveInput, searchSongs, songsOf, suggestQueries } from "./plugins";
import { normalizeTarget, type VoiceChannelTarget } from "./voice/target";
import { closeVoices, VoiceManager } from "./voice/VoiceManager";

const DEFAULTS = {
  historySize: 10,
  connectionTimeoutMs: 15_000,
  opusComplexity: 10,
  bufferMs: 500,
  searchLimit: 10,
};

export interface DisTubeOptions<Target = VoiceChannelTarget> {
  readonly adapter: Adapter<Target>;
  /** Ordered for resolve, search and suggest. At most one may carry an `engine`, which replaces the built-in one. */
  readonly plugins: readonly Plugin[];
  /** Ended occurrences each queue remembers. Integer 0 or greater, default 10. */
  readonly historySize?: number;
  /** Built-in engine presets, merged over its defaults. */
  readonly filters?: FilterDefinitions<string>;
  /** Voice join timeout in milliseconds, default 15000. */
  readonly connectionTimeoutMs?: number;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
  /** Built-in engine tuning; an engine plugin ignores it. */
  readonly engine?: {
    /** Opus encoder complexity from 0 to 10, default 10. */
    readonly opusComplexity?: number;
    /** Read-ahead in milliseconds, a positive multiple of 20, default 500. */
    readonly bufferMs?: number;
  };
}

export type PlayOptions<Metadata = unknown> = AddOptions<Metadata>;

/** Options for `distube.search`. `source` narrows the result type to that plugin's data. */
export interface SearchRequest<Source extends Plugin = Plugin> {
  readonly source?: Source;
  /** Positive integer, default 10. */
  readonly limit?: number;
  /** Non-negative integer, default 0. */
  readonly offset?: number;
  readonly signal?: AbortSignal;
}

/**
 * The public client. `Metadata` types `options.metadata` on every QueueItem, queue and event this client
 * hands back; core never reads it.
 */
export class DisTube<Metadata = unknown, Target = VoiceChannelTarget> {
  readonly voices: VoiceManager<Target>;
  readonly #adapter: Adapter<Target>;
  readonly #plugins: readonly Plugin[];
  readonly #engine: Engine;
  readonly #events: DisTubeEvents<Target>;
  readonly #historySize: number;
  readonly #queues = new Map<string, DisTubeQueue<Metadata, Target>>();
  readonly #insertions = new Map<string, Promise<unknown>>();
  readonly #work = new Set<Promise<unknown>>();
  readonly #lifetime = new AbortController();
  #disposal?: Promise<void>;

  constructor(options: DisTubeOptions<Target>) {
    const enginePlugin = validatePlugins(options.plugins);
    const historySize = options.historySize ?? DEFAULTS.historySize;
    const timeoutMs = options.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs;
    const opusComplexity = options.engine?.opusComplexity ?? DEFAULTS.opusComplexity;
    const bufferMs = options.engine?.bufferMs ?? DEFAULTS.bufferMs;
    requireInteger(historySize, "historySize", 0);
    requireInteger(timeoutMs, "connectionTimeoutMs", 1);
    requireInteger(opusComplexity, "engine.opusComplexity", 0, 10);
    requireInteger(bufferMs, "engine.bufferMs", 20);
    if (bufferMs % 20 !== 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "engine.bufferMs must be a multiple of 20");

    this.#adapter = options.adapter;
    this.#plugins = [...options.plugins];
    this.#historySize = historySize;
    this.#events = new DisTubeEvents(options.onDiagnostic ?? (() => undefined));
    this.#engine =
      enginePlugin?.engine ??
      options.adapter.createEngine({
        ...(options.filters ? { filters: options.filters } : {}),
        opusComplexity,
        bufferMs,
      });
    this.voices = new VoiceManager({
      adapter: options.adapter,
      engine: this.#engine,
      events: this.#events,
      timeoutMs,
      deleteQueue: (guildId, reason, error) => {
        const queue = this.#queues.get(guildId);
        if (queue) void queueControl.delete(queue, reason, error);
      },
    });
  }

  get queues(): ReadonlyMap<string, DisTubeQueue<Metadata, Target>> {
    return this.#queues;
  }

  getQueue(guildId: string): DisTubeQueue<Metadata, Target> | undefined {
    return this.#queues.get(guildId);
  }

  /**
   * Resolves `input`, joins `target` and adds the result to the guild queue, creating it synchronously.
   * Calls for one guild commit in invocation order.
   */
  play(
    target: Target,
    input: ResolvableInput,
    options: PlayOptions<Metadata> = {},
  ): Promise<DisTubeQueue<Metadata, Target>> {
    try {
      this.#assertLive();
      const { guildId } = normalizeTarget(this.#adapter, target);
      this.#validateAdd(input, options);
      const queue = this.#queues.get(guildId) ?? this.#createQueue(guildId);
      return this.#enqueue(queue, input, options, () => this.voices.join(target)).then(() => queue);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Resolves media through the plugins without touching queue or voice state. */
  resolve(input: ResolvableInput, options: { readonly signal?: AbortSignal } = {}): Promise<Song | Playlist> {
    return this.#run(options.signal, signal => {
      this.#validateInput(input);
      return resolveInput(this.#plugins, input, signal);
    });
  }

  /** Ranked results from `source`, or the first non-empty result in plugin order. */
  search<Source extends Plugin>(
    query: string,
    options: SearchRequest<Source> & { readonly source: Source },
  ): Promise<readonly Song<PluginDataOf<Source>>[]>;
  search(query: string, options?: SearchRequest): Promise<readonly Song[]>;
  search(query: string, options: SearchRequest = {}): Promise<readonly Song[]> {
    return this.#run(options.signal, signal => {
      requireQuery(query);
      this.#validateSource(options.source);
      const limit = options.limit ?? DEFAULTS.searchLimit;
      const offset = options.offset ?? 0;
      requireInteger(limit, "limit", 1);
      requireInteger(offset, "offset", 0);
      return searchSongs(this.#plugins, query, { ...options, limit, offset }, signal);
    });
  }

  /** Completions for a partial query, at most 25, from `source` or the first plugin that answers. */
  getSuggestions(
    query: string,
    source?: Plugin,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<readonly string[]> {
    return this.#run(options.signal, signal => {
      requireQuery(query);
      this.#validateSource(source);
      return suggestQueries(this.#plugins, query, source, signal);
    });
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata, Target>): () => void {
    return this.#events.on(name, listener as DisTubeEventListener<Name, unknown, Target>);
  }

  /** Deletes every queue, releases every voice, then disposes the plugins in reverse order. */
  dispose(): Promise<void> {
    this.#disposal ??= this.#shutdown();
    return this.#disposal;
  }

  #createQueue(guildId: string): DisTubeQueue<Metadata, Target> {
    const queue: DisTubeQueue<Metadata, Target> = new DisTubeQueue({
      guildId,
      historySize: this.#historySize,
      plugins: this.#plugins,
      engine: this.#engine,
      events: this.#events,
      voice: () => this.voices.get(guildId),
      add: (input, options) => {
        try {
          this.#assertLive();
          this.#validateAdd(input, options);
          return this.#enqueue(queue, input, options);
        } catch (error: unknown) {
          return Promise.reject(error);
        }
      },
      unregister: () => {
        if (this.#queues.get(guildId) === queue) this.#queues.delete(guildId);
      },
    });
    this.#queues.set(guildId, queue);
    return queue;
  }

  #enqueue(
    queue: DisTubeQueue<Metadata, Target>,
    input: ResolvableInput,
    options: AddOptions,
    join?: () => Promise<unknown>,
  ): Promise<readonly QueueItem[]> {
    const release = queueControl.reserve(queue);
    const lifetime = queueControl.signal(queue);
    const signal = AbortSignal.any([lifetime, this.#lifetime.signal, ...(options.signal ? [options.signal] : [])]);
    const assertCurrent = (): void => {
      this.#assertLive();
      if (lifetime.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "Queue was deleted before the insertion");
      throwIfAborted(options.signal);
    };
    const insertion = this.#serialize(queue.guildId, async () => {
      try {
        assertCurrent();
        const media = await resolveInput(this.#plugins, input, signal);
        assertCurrent();
        await join?.();
        assertCurrent();
        return queueControl.insert(queue, media, options);
      } catch (error: unknown) {
        assertCurrent();
        throw error;
      }
    });
    return insertion.finally(release);
  }

  #serialize<Value>(guildId: string, work: () => Promise<Value>): Promise<Value> {
    const run = (this.#insertions.get(guildId) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => undefined);
    this.#insertions.set(guildId, tail);
    void tail.then(() => {
      if (this.#insertions.get(guildId) === tail) this.#insertions.delete(guildId);
    });
    return run;
  }

  #run<Value>(caller: AbortSignal | undefined, operation: (signal: AbortSignal) => Promise<Value>): Promise<Value> {
    const signal = caller ? AbortSignal.any([caller, this.#lifetime.signal]) : this.#lifetime.signal;
    const settle = (): void => {
      this.#assertLive();
      throwIfAborted(caller);
    };
    const run = (async () => {
      settle();
      try {
        const value = await operation(signal);
        settle();
        return value;
      } catch (error: unknown) {
        settle();
        throw error;
      }
    })();
    this.#work.add(run);
    const forget = (): void => {
      this.#work.delete(run);
    };
    run.then(forget, forget);
    return run;
  }

  async #shutdown(): Promise<void> {
    this.#lifetime.abort();
    const queues = [...this.#queues.values()].map(queue => queueControl.delete(queue, "shutdown"));
    const voiceFailures = await closeVoices(this.voices);
    await Promise.allSettled([...queues, ...this.#insertions.values(), ...this.#work]);
    const sourceFailures: unknown[] = [];
    for (const plugin of this.#plugins.toReversed()) {
      try {
        await plugin.dispose?.();
      } catch (error: unknown) {
        sourceFailures.push(error);
      }
    }
    const failures = [...voiceFailures, ...sourceFailures];
    if (failures.length > 0) {
      throw new DisTubeError(
        voiceFailures.length > 0 ? ErrorCode.VOICE_FAILED : ErrorCode.SOURCE_FAILED,
        "DisTube shutdown cleanup failed",
        { cause: new AggregateError(failures, "DisTube shutdown cleanup failures") },
      );
    }
  }

  #validateAdd(input: ResolvableInput, options: AddOptions): void {
    this.#validateInput(input);
    if (options.at !== undefined) requireInteger(options.at, "at", 0);
    if (options.next !== undefined) requireBoolean(options.next, "next");
    if (options.at !== undefined && options.next !== undefined)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "next and at are mutually exclusive");
    throwIfAborted(options.signal);
  }

  #validateInput(input: ResolvableInput): void {
    if (typeof input === "string") {
      requireQuery(input);
      return;
    }
    if (!(input instanceof Song) && !(input instanceof Playlist))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Input must be a Song, a Playlist, a URL or a query");
    if (songsOf(input).some(song => !ownerOf(this.#plugins, song)))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Song source does not name a configured plugin");
  }

  #validateSource(source: Plugin | undefined): void {
    if (source !== undefined && !this.#plugins.includes(source))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "source must be a plugin configured on this client");
  }

  #assertLive(): void {
    if (this.#lifetime.signal.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTube is disposed");
  }
}

function validatePlugins(plugins: readonly Plugin[]): Plugin | undefined {
  const names = new Set<string>();
  const engines = plugins.filter(plugin => plugin.engine);
  if (engines.length > 1) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "At most one plugin may carry an engine");
  for (const plugin of plugins) {
    if (typeof plugin.name !== "string" || plugin.name.trim() !== plugin.name || plugin.name.length === 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Plugin names must be trimmed non-empty strings");
    if (names.has(plugin.name)) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Duplicate plugin ${plugin.name}`);
    names.add(plugin.name);
    if (!plugin.resolve && !plugin.search && !plugin.engine)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${plugin.name} needs resolve, search or engine`);
    if (engines.length === 0 && !plugin.stream)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${plugin.name} returns Songs but cannot stream them`);
  }
  return engines[0];
}

function requireInteger(value: number, name: string, min: number, max = Infinity): void {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${name} must be an integer from ${min} to ${max}`);
}

function requireQuery(query: string): void {
  if (typeof query !== "string" || query.trim().length === 0)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Query must be a non-empty string");
}
