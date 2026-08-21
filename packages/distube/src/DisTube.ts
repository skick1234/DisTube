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
import { asDisTubeError, DisTubeError, ErrorCode } from "./errors";
import {
  DisTubeEventEmitter,
  type DisTubeEventListener,
  type DisTubeEventName,
  type VoiceDisconnectReason,
} from "./events";
import type { GuildQueue } from "./GuildQueue";
import type { Playlist, QueueItem, Song } from "./media";
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

export interface PlayOptions {
  /** Zero-based slot in the pending list; absent appends, beyond the end clamps. */
  readonly position?: number;
  /** Caller-owned reference stored on every QueueItem the call creates. */
  readonly metadata?: unknown;
  /** Ends the current track once the insertion commits. Pair with `position: 0` to play the new media next. */
  readonly skip?: boolean;
}

export interface PlayResult {
  readonly queue: GuildQueue;
  readonly items: readonly QueueItem[];
}

export class DisTube {
  /** Guild voice presence, usable with or without a queue. */
  readonly voices: VoiceManager;
  readonly #plugins: readonly Plugin[];
  readonly #events: DisTubeEventEmitter;
  readonly #voiceManager: VoiceManagerImpl;
  readonly #queues: QueueManager;
  readonly #sources: SourceCatalog;
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
      for (const plugin of initialized.reverse())
        void Promise.resolve(plugin.dispose()).catch(disposeError =>
          this.#events.report({
            severity: "error",
            stage: "plugin.initialize.rollback",
            message: `${plugin.name}.dispose failed during initialization rollback`,
            plugin: plugin.name,
            error: asError(disposeError),
          }),
        );
      throw asDisTubeError(ErrorCode.PLUGIN_FAILED, "Plugin initialization failed", error);
    }
    this.#plugins = Object.freeze([...options.plugins]);
    const sources = this.#plugins.filter(isSourcePlugin) as readonly SourcePlugin[];
    this.#sources = createSourceCatalog(sources);
    // An engine-capable Plugin replaces the Adapter's default engine for every guild.
    const engine = this.#plugins.find(isEnginePlugin) ?? options.adapter.engine;
    this.#voiceManager = new VoiceManagerImpl(options.adapter, engine, {
      deleteQueue: (guildId, cause) => this.#queues.delete(guildId, cause),
      onDisconnected: (voice, reason, error) => this.#voiceDisconnected(voice, reason, error),
      report: diagnostic => this.#events.report(diagnostic),
    });
    this.voices = this.#voiceManager.facade;
    // QueueManager owns guild-ordered play work; its closures keep internal Voice capabilities private.
    this.#queues = new QueueManager(
      target => this.#voiceManager.joinInternal(target),
      guildId => this.#voiceManager.getInternal(guildId),
      guildId => this.#voiceManager.assertJoinable(guildId),
      voice => this.#voiceManager.releaseOwned(voice),
      engine,
      this.#sources,
      this.#events,
    );
  }

  /** The public facade for QueueManager's private, per-guild play lane. */
  play(target: PlayTarget, input: ResolvableInput, options: PlayOptions = {}): Promise<PlayResult> {
    return this.#queues.play(target, input, options);
  }

  /** Resolves media through the configured SourcePlugins without touching queue or voice state. */
  resolve(input: ResolvableInput, options: SourceOperationOptions = {}): Promise<Song | Playlist> {
    return resolveInput(input, this.#sources, options.signal ?? new AbortController().signal);
  }

  /** The guild's live GuildQueue, or `undefined` once it has been deleted. */
  getQueue(guildId: string): GuildQueue | undefined {
    return this.#queues.get(guildId);
  }

  get queues(): QueueCollection {
    return this.#queues.view;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    this.#events.on(name, listener);
    return this;
  }

  once<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    this.#events.once(name, listener);
    return this;
  }

  off<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name>): this {
    this.#events.off(name, listener);
    return this;
  }

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#performShutdown();
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
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "DisTube options are required");
    }
    const unknown = Object.keys(options).filter(key => !["adapter", "plugins", "onDiagnostic"].includes(key));
    if (unknown.length > 0) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown option: ${unknown[0]}`);
    if (
      !options.adapter ||
      typeof options.adapter.createVoiceSession !== "function" ||
      !isEngine(options.adapter.engine)
    ) {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "options.adapter must implement Adapter");
    }
    if (!Array.isArray(options.plugins))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "options.plugins must be an array");
    const instances = new Set<Plugin>();
    const names = new Set<string>();
    let engines = 0;
    for (const plugin of options.plugins) {
      if (!plugin || typeof plugin.initialize !== "function" || typeof plugin.dispose !== "function") {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Each plugin must implement Plugin");
      }
      validateSourceName(plugin.name, "Plugin name");
      if (instances.has(plugin) || names.has(plugin.name)) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Duplicate Plugin: ${plugin.name}`);
      }
      if (isEnginePlugin(plugin) && ++engines > 1) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Only one engine-capable Plugin is allowed: ${plugin.name}`);
      }
      instances.add(plugin);
      names.add(plugin.name);
    }
  }
}

/** Engine capability is structural, so a Plugin that satisfies the Engine members is one. */
function isEnginePlugin(plugin: Plugin): plugin is Plugin & Engine {
  return isEngine(plugin);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function cleanupCauses(error: Error): readonly Error[] {
  if (!(error instanceof DisTubeError)) return [error];
  if (error.cause instanceof AggregateError) {
    return error.cause.errors.flatMap((cause: unknown) => cleanupCauses(asError(cause)));
  }
  return error.cause instanceof Error ? cleanupCauses(error.cause) : [error];
}
