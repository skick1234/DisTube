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
import type { DisTubeGuild } from "./DisTubeGuild";
import { asDisTubeError, asError, DisTubeError, ErrorCode } from "./errors";
import {
  DisTubeEventEmitter,
  type DisTubeEventListener,
  type DisTubeEventName,
  type VoiceDisconnectReason,
} from "./events";
import type { Playlist, QueueItem, Song } from "./media";
import { throwIfAborted } from "./playback/abort";
import { resolveInput } from "./playback/resolve";
import { createSourceCatalog, type SourceCatalog } from "./playback/sources";
import { validateSourceName } from "./playback/validation";
import { type QueueCollection, QueueManager } from "./QueueManager";
import { settleAll } from "./utils/dispose";
import type { DisTubeVoice } from "./voice/DisTubeVoice";
import { type VoiceManager, VoiceManagerImpl } from "./voice/VoiceManager";

export interface DisTubeOptions {
  readonly adapter: Adapter;
  readonly sources: readonly SourcePlugin[];
  readonly engine?: Engine;
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void | Promise<void>;
}

export type { VoiceChannelTarget } from "./voice/target";

import type { VoiceChannelTarget } from "./voice/target";

export interface PlayOptions<Metadata = unknown> {
  readonly metadata?: Metadata;
  readonly signal?: AbortSignal;
}

export interface PlayResult<Metadata = unknown> {
  readonly queue: DisTubeGuild<Metadata>;
  readonly items: readonly QueueItem<Metadata>[];
}

/**
 * The public client.
 *
 * `Metadata` names the shape of `options.metadata`, and threads to every QueueItem, DisTubeGuild, DisTubeVoice, and
 * event payload this client hands back, so those reads need no cast. It is a type-level contract only:
 * core never inspects the value, and omitting the parameter leaves every `metadata` typed `unknown`.
 */
export class DisTube<Metadata = unknown> {
  /** Guild voice presence, usable with or without a queue. */
  readonly voices: VoiceManager;
  readonly #plugins: readonly (Engine | SourcePlugin)[];
  readonly #events: DisTubeEventEmitter;
  readonly #voiceManager: VoiceManagerImpl;
  readonly #queues: QueueManager;
  readonly #sources: SourceCatalog;
  readonly #resolutions = new Map<AbortController, Promise<Song | Playlist>>();
  #shuttingDown = false;
  #shutdownPromise?: Promise<void>;

  constructor(options: DisTubeOptions) {
    this.#validateOptions(options);
    const sources = Object.freeze([...options.sources]);
    const adapter = options.adapter;
    const engine = options.engine ?? adapter.engine;
    const diagnostic = options.onDiagnostic ?? (() => undefined);
    this.#events = new DisTubeEventEmitter(diagnostic);
    const integrations = [...new Set<Engine | SourcePlugin>([...sources, engine])];
    for (const integration of integrations) {
      if (ownedIntegrations.has(integration))
        throw new DisTubeError("INVALID_STATE", "Integration already belongs to a live client");
    }
    for (const integration of integrations) ownedIntegrations.add(integration);
    const initialized: (Engine | SourcePlugin)[] = [];
    try {
      for (const plugin of integrations) {
        const result: unknown = (
          plugin.initialize as ((context: Parameters<Plugin["initialize"]>[0]) => unknown) | undefined
        )?.({
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
        initialized.push(plugin);
      }
    } catch (error: unknown) {
      const reportRollbackFailure = (plugin: Engine | SourcePlugin, disposeError: unknown): void => {
        this.#events.report({
          severity: "error",
          stage: "plugin.initialize.rollback",
          message: `${plugin.name}.dispose failed during initialization rollback`,
          ...(plugin.name ? { plugin: plugin.name } : {}),
          error: asError(disposeError),
        });
      };
      const pending = new Set(initialized);
      for (const plugin of initialized.reverse()) {
        try {
          void Promise.resolve(plugin.dispose?.())
            .catch(disposeError => reportRollbackFailure(plugin, disposeError))
            .finally(() => ownedIntegrations.delete(plugin));
        } catch (disposeError: unknown) {
          reportRollbackFailure(plugin, disposeError);
          ownedIntegrations.delete(plugin);
        }
      }
      for (const integration of integrations) if (!pending.has(integration)) ownedIntegrations.delete(integration);
      throw asDisTubeError(ErrorCode.PLUGIN_FAILED, "Integration initialization failed", error);
    }
    this.#plugins = Object.freeze(integrations);
    this.#sources = createSourceCatalog(sources);
    this.#voiceManager = new VoiceManagerImpl(adapter, engine, {
      order: (guildId, work) => this.#queues.order(guildId, work),
      deleteQueue: (guildId, cause) => this.#queues.delete(guildId, cause),
      onDisconnected: (voice, reason, error) => this.#voiceDisconnected(voice, reason, error),
      report: diagnostic => this.#events.report(diagnostic),
    });
    this.voices = this.#voiceManager.facade;
    // QueueManager owns guild-ordered play work; its closures keep internal DisTubeVoice capabilities private.
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
  play(
    target: VoiceChannelTarget,
    input: ResolvableInput,
    options: PlayOptions<Metadata> = {},
  ): Promise<PlayResult<Metadata>> {
    return this.#queues.play(target, input, options) as Promise<PlayResult<Metadata>>;
  }

  /**
   * Resolves media through the configured SourcePlugins without touching queue or voice state.
   *
   * Disposal fences this the same way it fences play and join: once `dispose()` starts, the plugins are
   * on their way to `dispose()`, so a resolution begun now would outlive them.
   */
  resolve(input: ResolvableInput, options: SourceOperationOptions = {}): Promise<Song | Playlist> {
    if (this.#shuttingDown) return Promise.reject(this.#shutdownError());
    if (
      !options ||
      typeof options !== "object" ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))
    ) {
      return Promise.reject(new DisTubeError("INVALID_ARGUMENT", "Invalid resolution options"));
    }
    const controller = new AbortController();
    const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
    const operation = Promise.resolve().then(async () => {
      try {
        throwIfAborted(signal);
        const media = await resolveInput(input, this.#sources, signal);
        if (this.#shuttingDown) throw this.#shutdownError();
        throwIfAborted(signal);
        return media;
      } catch (error: unknown) {
        if (this.#shuttingDown) throw this.#shutdownError();
        throw error;
      } finally {
        this.#resolutions.delete(controller);
      }
    });
    this.#resolutions.set(controller, operation);
    return operation;
  }

  /** The guild's live DisTubeGuild, or `undefined` once it has been deleted. */
  getQueue(guildId: string): DisTubeGuild<Metadata> | undefined {
    return this.#queues.get(guildId) as DisTubeGuild<Metadata> | undefined;
  }

  get queues(): QueueCollection<Metadata> {
    return this.#queues.view as QueueCollection<Metadata>;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, Metadata>): () => void {
    return this.#events.on(name, listener as DisTubeEventListener<Name>);
  }

  dispose(): Promise<void> {
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
    await Promise.allSettled([...this.#resolutions.values()]);
    const pluginFailures = await settleAll([...this.#plugins].reverse().map(plugin => () => plugin.dispose?.()));
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

  #voiceDisconnected(voice: DisTubeVoice, reason: VoiceDisconnectReason, error?: Error): void {
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

  #validateOptions(options: DisTubeOptions): void {
    if (!options || typeof options !== "object")
      throw new DisTubeError("INVALID_ARGUMENT", "DisTube options are required");
    if (Object.keys(options).some(key => !["adapter", "sources", "engine", "onDiagnostic"].includes(key))) {
      throw new DisTubeError("INVALID_ARGUMENT", "Unknown DisTube option");
    }
    if (
      !options.adapter ||
      typeof options.adapter.createVoiceSession !== "function" ||
      !isEngine(options.adapter.engine)
    ) {
      throw new DisTubeError("INVALID_ARGUMENT", "options.adapter must implement Adapter");
    }
    if (!Array.isArray(options.sources)) throw new DisTubeError("INVALID_ARGUMENT", "options.sources must be an array");
    const names = new Set<string>();
    for (const source of options.sources) {
      if (!isSourcePlugin(source) || typeof source.initialize !== "function" || typeof source.dispose !== "function") {
        throw new DisTubeError("INVALID_ARGUMENT", "Each source must implement SourcePlugin");
      }
      validateSourceName(source.name);
      if (names.has(source.name)) throw new DisTubeError("INVALID_ARGUMENT", "Duplicate source name");
      names.add(source.name);
    }
    const engine = options.engine ?? options.adapter.engine;
    if (!isEngine(engine)) throw new DisTubeError("INVALID_ARGUMENT", "options.engine must implement Engine");
    if (engine.name !== undefined) {
      validateSourceName(engine.name, "Engine name");
      if (options.sources.some(source => source.name === engine.name && source !== engine)) {
        throw new DisTubeError("INVALID_ARGUMENT", "Distinct source and engine instances cannot share a name");
      }
    }
    if (
      (engine.initialize !== undefined || engine.dispose !== undefined) &&
      (typeof engine.initialize !== "function" || typeof engine.dispose !== "function")
    ) {
      throw new DisTubeError("INVALID_ARGUMENT", "Engine initialize and dispose must be supplied together");
    }
    if (options.onDiagnostic !== undefined && typeof options.onDiagnostic !== "function") {
      throw new DisTubeError("INVALID_ARGUMENT", "onDiagnostic must be a function");
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

const ownedIntegrations = new WeakSet<object>();
