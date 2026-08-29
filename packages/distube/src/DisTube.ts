import type {
  Adapter,
  Diagnostic,
  Engine,
  Plugin,
  ResolvableInput,
  SourceOperationOptions,
  SourcePlugin,
} from "./contracts";
import { isEngine, isSourcePlugin } from "./contracts";
import { ErrorReason } from "./enums";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "./errors";
import {
  DisTubeEventEmitter,
  type DisTubeEventListener,
  type DisTubeEventName,
  type VoiceDisconnectReason,
} from "./events";
import type { GuildQueue } from "./GuildQueue";
import type { Playlist, QueueItem, Song } from "./media";
import { throwIfAborted } from "./playback/abort";
import { resolveInput } from "./playback/resolve";
import { createSourceCatalog, type SourceCatalog } from "./playback/sources";
import { validateSourceName } from "./playback/validation";
import { type QueueCollection, QueueManager } from "./QueueManager";
import { settleAll } from "./utils/dispose";
import type { Voice } from "./voice/Voice";
import { type VoiceManager, VoiceManagerImpl } from "./voice/VoiceManager";

export interface DisTubeOptions {
  readonly adapter: Adapter;
  readonly plugins: readonly Plugin[];
  readonly onDiagnostic?: (diagnostic: Diagnostic) => unknown;
}

/** The guild and voice channel a `play` call targets, in platform-neutral IDs. */
export interface PlayTarget {
  readonly guildId: string;
  readonly voiceChannelId: string;
}

export interface PlayOptions<Metadata = unknown> {
  /** Zero-based slot in the pending list; absent appends, beyond the end clamps. */
  readonly position?: number;
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: Metadata;
  /** Ends the current track once the insertion commits. Pair with `position: 0` to play the new media next. */
  readonly skip?: boolean;
  /** Cancels the call; it then rejects with `QUEUE_FAILED` and leaves no queue, item, or event behind. */
  readonly signal?: AbortSignal;
}

export interface PlayResult<Metadata = unknown> {
  readonly queue: GuildQueue<Metadata>;
  readonly items: readonly QueueItem<Metadata>[];
}

/**
 * The public client.
 *
 * `Metadata` names the shape of `options.metadata`, and threads to every QueueItem, GuildQueue, Voice, and
 * event payload this client hands back, so those reads need no cast. It is a type-level contract only:
 * core never inspects the value, and omitting the parameter leaves every `metadata` typed `unknown`.
 */
export class DisTube<Metadata = unknown> {
  /** Guild voice presence, usable with or without a queue. */
  readonly voices: VoiceManager<Metadata>;
  readonly #plugins: readonly Plugin[];
  readonly #events: DisTubeEventEmitter;
  readonly #voiceManager: VoiceManagerImpl;
  readonly #queues: QueueManager;
  readonly #sources: SourceCatalog;
  readonly #resolutions = new Set<AbortController>();
  #shuttingDown = false;
  #shutdownPromise?: Promise<void>;

  constructor(options: DisTubeOptions) {
    this.#validateOptions(options);
    const diagnostic = options.onDiagnostic ?? (() => undefined);
    this.#events = new DisTubeEventEmitter(diagnostic);
    const initialized: Plugin[] = [];
    try {
      for (const plugin of options.plugins) {
        const result: unknown = (plugin.initialize as (context: Parameters<Plugin["initialize"]>[0]) => unknown)({
          diagnostic: record => this.#events.report(Object.freeze({ ...record, plugin: plugin.name })),
        });
        if (result && typeof (result as PromiseLike<unknown>).then === "function") {
          void Promise.resolve(result).catch(error =>
            this.#events.report({
              severity: "error",
              stage: "plugin.initialize.late-rejection",
              message: `${plugin.name}.initialize rejected after returning an unsupported thenable`,
              plugin: plugin.name,
              error: asError(error),
            }),
          );
          throw new Error(`${plugin.name}.initialize must be synchronous`);
        }
        initialized.push(plugin);
      }
    } catch (error: unknown) {
      const reportRollbackFailure = (plugin: Plugin, disposeError: unknown): void => {
        this.#events.report({
          severity: "error",
          stage: "plugin.initialize.rollback",
          message: `${plugin.name}.dispose failed during initialization rollback`,
          plugin: plugin.name,
          error: asError(disposeError),
        });
      };
      for (const plugin of initialized.reverse()) {
        try {
          void Promise.resolve(plugin.dispose()).catch(disposeError => reportRollbackFailure(plugin, disposeError));
        } catch (disposeError: unknown) {
          reportRollbackFailure(plugin, disposeError);
        }
      }
      throw asDisTubeError(ErrorCode.PLUGIN_FAILED, "Plugin initialization failed", error);
    }
    this.#plugins = Object.freeze([...options.plugins]);
    const sources = this.#plugins.filter(isSourcePlugin) as readonly SourcePlugin[];
    this.#sources = createSourceCatalog(sources);
    // An engine-capable Plugin replaces the Adapter's default engine for every guild.
    const engine = (options.plugins.find(isEngine) as Engine | undefined) ?? options.adapter.engine;
    this.#voiceManager = new VoiceManagerImpl(options.adapter, engine, {
      deleteQueue: (guildId, cause) => this.#queues.delete(guildId, cause),
      onDisconnected: (voice, reason, error) => this.#voiceDisconnected(voice, reason, error),
      report: diagnostic => this.#events.report(diagnostic),
    });
    // The implementation is metadata-blind; this is where the client's declared type is put on it.
    this.voices = this.#voiceManager.facade as VoiceManager<Metadata>;
    // QueueManager owns guild-ordered play work; its closures keep internal Voice capabilities private.
    this.#queues = new QueueManager(
      target => this.#voiceManager.joinInternal(target),
      guildId => this.#voiceManager.getInternal(guildId),
      guildId => this.#voiceManager.assertJoinable(guildId),
      voice => this.#voiceManager.releaseOwned(voice),
      this.#sources,
      this.#events,
    );
  }

  /** The public facade for QueueManager's private, per-guild play lane. */
  play(target: PlayTarget, input: ResolvableInput, options: PlayOptions<Metadata> = {}): Promise<PlayResult<Metadata>> {
    return this.#queues.play(target, input, options) as Promise<PlayResult<Metadata>>;
  }

  /**
   * Resolves media through the configured SourcePlugins without touching queue or voice state.
   *
   * Shutdown fences this the same way it fences play and join: once `shutdown()` starts, the plugins are
   * on their way to `dispose()`, so a resolution begun now would outlive them.
   */
  async resolve(input: ResolvableInput, options: SourceOperationOptions = {}): Promise<Song | Playlist> {
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    throwIfAborted(signal);
    if (this.#shuttingDown) throw this.#shutdownError();
    this.#resolutions.add(controller);
    try {
      const media = await resolveInput(input, this.#sources, signal);
      throwIfAborted(signal);
      return media;
    } finally {
      this.#resolutions.delete(controller);
    }
  }

  /** The guild's live GuildQueue, or `undefined` once it has been deleted. */
  getQueue(guildId: string): GuildQueue<Metadata> | undefined {
    return this.#queues.get(guildId) as GuildQueue<Metadata> | undefined;
  }

  get queues(): QueueCollection<Metadata> {
    return this.#queues.view as QueueCollection<Metadata>;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata>): this {
    this.#events.on(name, listener as DisTubeEventListener<Name>);
    return this;
  }

  once<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata>): this {
    this.#events.once(name, listener as DisTubeEventListener<Name>);
    return this;
  }

  /** Removes one registration of `listener`, whether it was added with `on` or with `once`. */
  off<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata>): this {
    this.#events.off(name, listener as DisTubeEventListener<Name>);
    return this;
  }

  /** Drops every listener for `name`, or for every event when `name` is omitted. */
  removeAllListeners(name?: DisTubeEventName): this {
    this.#events.removeAllListeners(name);
    return this;
  }

  shutdown(): Promise<void> {
    if (!this.#shutdownPromise) {
      this.#shuttingDown = true;
      this.#fenceResolutions();
      this.#shutdownPromise = this.#performShutdown();
    }
    return this.#shutdownPromise;
  }

  async #performShutdown(): Promise<void> {
    this.#queues.fence();
    this.#voiceManager.fence();
    const queueFailures = await this.#queues.deleteAll({ kind: "shutdown" });
    const voiceFailures = await this.#voiceManager.releaseAll();
    const pluginFailures = await settleAll([...this.#plugins].reverse().map(plugin => () => plugin.dispose()));
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
    for (const controller of this.#resolutions) controller.abort(this.#shutdownError());
  }

  #shutdownError(): DisTubeError {
    return new DisTubeError(ErrorCode.QUEUE_FAILED, "DisTube is shutting down");
  }

  #voiceDisconnected(voice: Voice, reason: VoiceDisconnectReason, error?: Error): void {
    this.#events.emit(
      "voice.disconnected",
      Object.freeze({
        guildId: voice.guildId,
        timestamp: Date.now(),
        reason,
        ...(error ? { error: asDisTubeError(ErrorCode.VOICE_FAILED, "Voice disconnected terminally", error) } : {}),
      }),
    );
  }

  #validateOptions(options: DisTubeOptions): void {
    if (!options || typeof options !== "object") {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "DisTube options are required");
    }
    const unknown = Object.keys(options).filter(key => !["adapter", "plugins", "onDiagnostic"].includes(key));
    if (unknown.length > 0)
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, `Unknown option: ${unknown[0]}`);
    if (
      !options.adapter ||
      typeof options.adapter.createVoiceSession !== "function" ||
      !isEngine(options.adapter.engine)
    ) {
      throw new DisTubeError(
        ErrorCode.INVALID_ARGUMENT,
        ErrorReason.Argument,
        "options.adapter must implement Adapter",
      );
    }
    if (!Array.isArray(options.plugins))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "options.plugins must be an array");
    const instances = new Set<Plugin>();
    const names = new Set<string>();
    let engines = 0;
    for (const plugin of options.plugins) {
      if (!plugin || typeof plugin.initialize !== "function" || typeof plugin.dispose !== "function") {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, "Each plugin must implement Plugin");
      }
      validateSourceName(plugin.name, "Plugin name");
      if (instances.has(plugin) || names.has(plugin.name)) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, ErrorReason.Argument, `Duplicate Plugin: ${plugin.name}`);
      }
      // An engine-capable Plugin replaces the Adapter's default engine for every guild.
      if (isEngine(plugin)) {
        engines += 1;
        const engineName: string | undefined = (plugin as { name?: string }).name;
        if (engines > 1) {
          throw new DisTubeError(
            ErrorCode.INVALID_ARGUMENT,
            ErrorReason.Argument,
            `Only one engine-capable Plugin is allowed${engineName ? `: ${engineName}` : ""}`,
          );
        }
      }
      instances.add(plugin);
      names.add(plugin.name);
    }
  }
}

function cleanupCauses(error: Error): readonly Error[] {
  if (!(error instanceof DisTubeError)) return [error];
  if (error.cause instanceof AggregateError) {
    return error.cause.errors.flatMap((cause: unknown) => cleanupCauses(asError(cause)));
  }
  return error.cause instanceof Error ? cleanupCauses(error.cause) : [error];
}
