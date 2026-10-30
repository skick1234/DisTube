import type {
  Adapter,
  Diagnostic,
  FilterDefinitions,
  Plugin,
  PluginDataOf,
  ResolvableInput,
  VoiceChannelTarget,
} from "./contracts";
import { DisTubeError, ErrorCode, requireBoolean, requireInteger, requireQuery, throwIfAborted } from "./errors";
import { DisTubeEvents, type DisTubeEventListener, type DisTubeEventName } from "./events";
import { Guilds } from "./guild";
import type { Playlist, Song } from "./media";
import { type AddArguments, type AddOptions, type DisTubeQueue, validateAdd } from "./queue";
import { resolveInput, searchSongs, suggestQueries, validateInput } from "./sources";
import { normalizeTarget, VoiceManager } from "./voice";

const DEFAULTS = {
  historySize: 10,
  maxPlaylistSongs: 500,
  connectionTimeoutMs: 15_000,
  opusComplexity: 10,
  bufferMs: 500,
  searchLimit: 10,
};
const MAX_TIMER_MS = 2_147_483_647;

export interface DisTubeOptions<Target = VoiceChannelTarget> {
  readonly adapter: Adapter<Target>;
  /** Ordered for resolve, search and suggest. At most one may carry an `engine`, which replaces the built-in one. */
  readonly plugins: readonly Plugin[];
  /** Ended occurrences each queue remembers. Integer 0 or greater, default 10. */
  readonly historySize?: number;
  /** Songs a resolved Playlist keeps, the first ones in provider order. Positive integer, default 500. */
  readonly maxPlaylistSongs?: number;
  /** Built-in engine presets, merged over its defaults. */
  readonly filters?: FilterDefinitions<string>;
  /** Voice join timeout in milliseconds, up to 2147483647. Default 15000. */
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

export type PlayOptions<Metadata = undefined> = AddOptions<Metadata>;

/** Options for `distube.search`. `source` narrows the result type to that plugin's data. */
export interface SearchRequest<Source extends Plugin = Plugin> {
  readonly source?: Source;
  /** Positive integer, default 10. */
  readonly limit?: number;
  /** Non-negative integer, default 0. */
  readonly offset?: number;
  readonly signal?: AbortSignal;
  /**
   * Unless `true`, leaves out results whose `ageRestricted` is true. Results whose answer is unknown stay; `play` checks
   * them.
   * @defaultValue `false`
   */
  readonly allowAgeRestricted?: boolean;
}

/** Options for `distube.suggest`. */
export interface SuggestRequest {
  /** Ask only this plugin. */
  readonly source?: Plugin;
  readonly signal?: AbortSignal;
}

/**
 * The public client. `Metadata` types `options.metadata` on every QueueItem, queue and event this client
 * hands back; core never reads it.
 */
export class DisTube<Metadata = undefined, Target = VoiceChannelTarget> {
  readonly voices: VoiceManager<Target>;
  readonly #plugins: readonly Plugin[];
  readonly #events: DisTubeEvents<Target>;
  readonly #guilds: Guilds<Target>;
  readonly #lifetime = new AbortController();
  #disposal?: Promise<void>;

  constructor(options: DisTubeOptions<Target>) {
    const enginePlugin = validatePlugins(options.plugins);
    const historySize = options.historySize ?? DEFAULTS.historySize;
    const maxPlaylistSongs = options.maxPlaylistSongs ?? DEFAULTS.maxPlaylistSongs;
    const connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULTS.connectionTimeoutMs;
    const opusComplexity = options.engine?.opusComplexity ?? DEFAULTS.opusComplexity;
    const bufferMs = options.engine?.bufferMs ?? DEFAULTS.bufferMs;
    requireInteger(historySize, "historySize", 0);
    requireInteger(maxPlaylistSongs, "maxPlaylistSongs", 1);
    requireInteger(connectionTimeoutMs, "connectionTimeoutMs", 1, MAX_TIMER_MS);
    requireInteger(opusComplexity, "engine.opusComplexity", 0, 10);
    requireInteger(bufferMs, "engine.bufferMs", 20);
    if (bufferMs % 20 !== 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "engine.bufferMs must be a multiple of 20");

    this.#plugins = [...options.plugins];
    this.#events = new DisTubeEvents(options.onDiagnostic ?? (() => undefined));
    this.#guilds = new Guilds({
      adapter: options.adapter,
      engine:
        enginePlugin?.engine ??
        options.adapter.createEngine({
          ...(options.filters ? { filters: options.filters } : {}),
          opusComplexity,
          bufferMs,
        }),
      plugins: this.#plugins,
      events: this.#events,
      historySize,
      maxPlaylistSongs,
      connectionTimeoutMs,
      lifetime: this.#lifetime.signal,
    });
    this.voices = new VoiceManager(this.#guilds);
  }

  get queues(): ReadonlyMap<string, DisTubeQueue<Metadata, Target>> {
    return this.#guilds.queues as ReadonlyMap<string, DisTubeQueue<Metadata, Target>>;
  }

  getQueue(guildId: string): DisTubeQueue<Metadata, Target> | undefined {
    return this.queues.get(guildId);
  }

  /**
   * Resolves `input`, joins `target` and adds the result to the guild queue, creating it synchronously.
   * Calls for one guild commit in invocation order.
   */
  play(
    target: Target,
    input: ResolvableInput,
    ...args: AddArguments<Metadata>
  ): Promise<DisTubeQueue<Metadata, Target>> {
    const options: AddOptions<unknown> = args[0] ?? {};
    try {
      const { guildId } = normalizeTarget(this.#guilds.config.adapter, target);
      validateAdd(this.#plugins, input, options);
      this.#assertLive();
      const guild = this.#guilds.ensure(guildId);
      const queue = guild.queue ?? guild.createQueue();
      return queue
        .admit(input, options, () => this.voices.join(target))
        .then(() => queue as DisTubeQueue<Metadata, Target>);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
  }

  /** Resolves media through the plugins without touching queue or voice state. */
  resolve(input: ResolvableInput, options: { readonly signal?: AbortSignal } = {}): Promise<Song | Playlist> {
    return this.#run(
      options.signal,
      () => validateInput(this.#plugins, input),
      signal => resolveInput(this.#plugins, input, signal, this.#guilds.config.maxPlaylistSongs, true),
    );
  }

  /** Ranked results from `source`, or the first non-empty result in plugin order. */
  search<Source extends Plugin>(
    query: string,
    options: SearchRequest<Source> & { readonly source: Source },
  ): Promise<readonly Song<PluginDataOf<Source>>[]>;
  search(query: string, options?: SearchRequest): Promise<readonly Song[]>;
  search(query: string, options: SearchRequest = {}): Promise<readonly Song[]> {
    const limit = options.limit ?? DEFAULTS.searchLimit;
    const offset = options.offset ?? 0;
    return this.#run(
      options.signal,
      () => {
        requireQuery(query);
        this.#validateSource(options.source);
        requireInteger(limit, "limit", 1);
        requireInteger(offset, "offset", 0);
        if (options.allowAgeRestricted !== undefined) requireBoolean(options.allowAgeRestricted, "allowAgeRestricted");
      },
      signal => searchSongs(this.#plugins, query, { ...options, limit, offset }, signal),
    );
  }

  /** Completions for a partial query, at most 25, from `source` or the first plugin that answers. */
  suggest(query: string, options: SuggestRequest = {}): Promise<readonly string[]> {
    return this.#run(
      options.signal,
      () => {
        requireQuery(query);
        this.#validateSource(options.source);
      },
      signal => suggestQueries(this.#plugins, query, options.source, signal),
    );
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata, Target>): () => void {
    return this.#events.on(name, listener as DisTubeEventListener<Name, unknown, Target>);
  }

  /** Deletes every queue, releases every voice, then disposes the plugins in reverse order. */
  dispose(): Promise<void> {
    this.#disposal ??= this.#shutdown();
    return this.#disposal;
  }

  #run<Value>(
    caller: AbortSignal | undefined,
    validate: () => void,
    operation: (signal: AbortSignal) => Promise<Value>,
  ): Promise<Value> {
    const signal = caller ? AbortSignal.any([caller, this.#lifetime.signal]) : this.#lifetime.signal;
    const settle = (): void => {
      this.#assertLive();
      throwIfAborted(caller);
    };
    const run = (async () => {
      validate();
      throwIfAborted(caller);
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
    this.#guilds.track(run);
    return run;
  }

  async #shutdown(): Promise<void> {
    this.#lifetime.abort();
    const queues = [...this.#guilds.queues.values()].map(queue => queue.delete("shutdown"));
    const voiceFailures = await this.#guilds.close();
    await Promise.allSettled([...queues, ...this.#guilds.work]);
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
  const playsAnySong =
    engines.some(plugin => plugin.engine?.prepare) || plugins.some(plugin => plugin.search && plugin.stream);
  for (const plugin of plugins) {
    if (typeof plugin.name !== "string" || plugin.name.trim() !== plugin.name || plugin.name.length === 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Plugin names must be trimmed non-empty strings");
    if (names.has(plugin.name)) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Duplicate plugin ${plugin.name}`);
    names.add(plugin.name);
    if (!plugin.resolve && !plugin.search && !plugin.stream && !plugin.engine)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${plugin.name} needs resolve, search, stream or engine`);
    if (!plugin.stream && !playsAnySong)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `${plugin.name} cannot stream and nothing plays its Songs`);
  }
  return engines[0];
}
