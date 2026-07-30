import type { Adapter, CreateQueueOptions, Diagnostic, Plugin, SourcePlugin } from "./contracts";
import { isSourcePlugin } from "./contracts";
import { asDisTubeError, DisTubeError, ErrorCode } from "./errors";
import { QueueEventEmitter, type QueueEventListener, type QueueEventName } from "./events";
import type { GuildQueue } from "./GuildQueue";
import { createSourceCatalog } from "./playback/sources";
import { validateSourceName } from "./playback/validation";
import { QueueManager } from "./QueueManager";
import { settleAll } from "./utils/dispose";

export interface DisTubeOptions {
  readonly adapter: Adapter;
  readonly plugins: readonly Plugin[];
  readonly onDiagnostic?: (diagnostic: Diagnostic) => unknown;
}

export class DisTube {
  readonly #plugins: readonly Plugin[];
  readonly #events: QueueEventEmitter;
  readonly #queues: QueueManager;
  #shuttingDown = false;
  #shutdownPromise?: Promise<void>;

  constructor(options: DisTubeOptions) {
    this.#validateOptions(options);
    const diagnostic = options.onDiagnostic ?? (() => undefined);
    this.#events = new QueueEventEmitter(diagnostic);
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
    this.#queues = new QueueManager(options.adapter, createSourceCatalog(sources), this.#events);
  }

  createQueue(options: CreateQueueOptions): GuildQueue {
    this.#assertReady();
    return this.#queues.create(options);
  }

  getQueue(queueId: string): GuildQueue | undefined {
    return this.#queues.get(queueId);
  }

  destroyQueue(queueId: string): Promise<void> {
    this.#assertReady();
    return this.#queues.destroy(queueId);
  }

  on<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    this.#events.on(name, listener);
    return this;
  }

  once<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    this.#events.once(name, listener);
    return this;
  }

  off<Name extends QueueEventName>(name: Name, listener: QueueEventListener<Name>): this {
    this.#events.off(name, listener);
    return this;
  }

  shutdown(): Promise<void> {
    this.#shutdownPromise ??= this.#performShutdown();
    return this.#shutdownPromise;
  }

  async #performShutdown(): Promise<void> {
    this.#shuttingDown = true;
    const queueFailures = await this.#queues.destroyAll();
    const pluginFailures = await settleAll([...this.#plugins].reverse().map(plugin => () => plugin.dispose()));
    const failures = [...queueFailures.flatMap(cleanupCauses), ...pluginFailures.flatMap(cleanupCauses)];
    if (failures.length > 0) {
      throw new DisTubeError(
        queueFailures.length > 0 ? ErrorCode.QUEUE_FAILED : ErrorCode.PLUGIN_FAILED,
        "DisTube shutdown cleanup failed",
        { cause: new AggregateError(failures, "DisTube shutdown cleanup failures") },
      );
    }
  }

  #validateOptions(options: DisTubeOptions): void {
    if (!options || typeof options !== "object") {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "DisTube options are required");
    }
    const unknown = Object.keys(options).filter(key => !["adapter", "plugins", "onDiagnostic"].includes(key));
    if (unknown.length > 0) throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Unknown option: ${unknown[0]}`);
    if (!options.adapter || typeof options.adapter.createPlayer !== "function") {
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "options.adapter must implement Adapter");
    }
    if (!Array.isArray(options.plugins))
      throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "options.plugins must be an array");
    const instances = new Set<Plugin>();
    const names = new Set<string>();
    for (const plugin of options.plugins) {
      if (!plugin || typeof plugin.initialize !== "function" || typeof plugin.dispose !== "function") {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Each plugin must implement Plugin");
      }
      validateSourceName(plugin.name, "Plugin name");
      if (instances.has(plugin) || names.has(plugin.name)) {
        throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Duplicate Plugin: ${plugin.name}`);
      }
      instances.add(plugin);
      names.add(plugin.name);
    }
  }

  #assertReady(): void {
    if (this.#shuttingDown) throw new DisTubeError(ErrorCode.QUEUE_FAILED, "DisTube is shutting down");
  }
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
