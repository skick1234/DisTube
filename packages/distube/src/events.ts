import type { Diagnostic, VoiceChannelTarget } from "./contracts";
import type { DisTubeError } from "./errors";
import type { Playlist, QueueItem, Song } from "./media";
import type { DisTubeQueue } from "./queue";
import type { QueueState } from "./queue-state";
import type { DisTubeVoice } from "./voice";

export interface BaseQueueEvent<Metadata = unknown, Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly queue: DisTubeQueue<Metadata, Target>;
  readonly state: QueueState<Metadata>;
  /** When the transition committed, not when the listener runs. */
  readonly timestamp: number;
}

export interface BaseVoiceEvent<Target = VoiceChannelTarget> {
  readonly guildId: string;
  readonly voice: DisTubeVoice<Target>;
  readonly timestamp: number;
}

/** Why a queue was deleted. */
export type QueueDeleteReason = "stop" | "finished" | "voice-loss" | "leave" | "shutdown" | "failed";

/** Why a guild's DisTubeVoice ended. */
export type VoiceDisconnectReason = "left" | "platform" | "shutdown" | "idle";

export interface DisTubeEventMap<Metadata = unknown, Target = VoiceChannelTarget> {
  "queue.created": Readonly<BaseQueueEvent<Metadata, Target>>;
  "queue.item.added": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  /** One resolved Playlist committed as a whole; its items publish no per-item events. */
  "queue.playlist.added": Readonly<
    BaseQueueEvent<Metadata, Target> & { playlist: Playlist; items: readonly QueueItem<Metadata>[] }
  >;
  "queue.item.started": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  "queue.item.finished": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata> }>;
  "queue.item.failed": Readonly<BaseQueueEvent<Metadata, Target> & { item: QueueItem<Metadata>; error: DisTubeError }>;
  /** Playback ran out of successors; `queue.deleted` follows. */
  "queue.finished": Readonly<BaseQueueEvent<Metadata, Target>>;
  "queue.autoplay.failed": Readonly<BaseQueueEvent<Metadata, Target> & { song: Song; error: DisTubeError }>;
  "queue.deleted": Readonly<BaseQueueEvent<Metadata, Target> & { reason: QueueDeleteReason }>;
  /** Published once per DisTubeVoice, after that guild's `queue.deleted`. */
  "voice.disconnected": Readonly<
    BaseVoiceEvent<Target> & { channelId: string; reason: VoiceDisconnectReason; error?: DisTubeError }
  >;
}

export type DisTubeEventName = keyof DisTubeEventMap;
export type DisTubeEventListener<Name extends DisTubeEventName, Metadata = unknown, Target = VoiceChannelTarget> = (
  event: DisTubeEventMap<Metadata, Target>[Name],
) => unknown;

type Listener = (event: never) => unknown;

/** Delivers each event in a later microtask, in emit order; a listener failure reaches only `onDiagnostic`. */
export class DisTubeEvents<Target = VoiceChannelTarget> {
  readonly #listeners = new Map<DisTubeEventName, Set<Listener>>();
  readonly #diagnostic: (diagnostic: Diagnostic) => unknown;

  constructor(diagnostic: (diagnostic: Diagnostic) => unknown) {
    this.#diagnostic = diagnostic;
  }

  on<Name extends DisTubeEventName>(name: Name, listener: DisTubeEventListener<Name, unknown, Target>): () => void {
    const registration: Listener = event => listener(event);
    const listeners = this.#listeners.get(name) ?? new Set<Listener>();
    listeners.add(registration);
    this.#listeners.set(name, listeners);
    return () => listeners.delete(registration);
  }

  emit<Name extends DisTubeEventName>(name: Name, event: DisTubeEventMap<unknown, Target>[Name]): void {
    Object.freeze(event);
    queueMicrotask(() => {
      for (const listener of Array.from(this.#listeners.get(name) ?? [])) {
        const failed = (error: unknown): void =>
          this.report({ severity: "error", stage: "event.listener", message: `Listener failed for ${name}`, error });
        try {
          void Promise.resolve(listener(event as never)).catch(failed);
        } catch (error: unknown) {
          failed(error);
        }
      }
    });
  }

  report(diagnostic: Diagnostic): void {
    try {
      void Promise.resolve(this.#diagnostic(diagnostic)).catch(() => undefined);
    } catch {}
  }
}
