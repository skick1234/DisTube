import { vi } from "vitest";
import {
  type Diagnostic,
  DisTube,
  type DisTubeEventListener,
  type DisTubeEventName,
  type Playlist,
  Song,
  type VoiceChannelTarget,
} from "../../src";
import { Filters } from "../../src/enums";
import type {
  Adapter,
  Engine,
  FilterDefinitionInfo,
  FilterDefinitions,
  FilterEntry,
  JoinOptions,
  PlaybackContext,
  PlaybackPreparation,
  PlaybackRequest,
  PlaybackResource,
  Player,
  PlayerEvent,
  PluginContext,
  RelatedContext,
  SourceOperationOptions,
  SourcePlugin,
  VoiceGatewayData,
  VoiceSession,
  VoiceSessionEvent,
  VoiceTarget,
} from "../../src/integrations";

export interface Deferred<Value> {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
  readonly reject: (error: unknown) => void;
}

export function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Advances Promise jobs without yielding to timers. Deferred lifecycle tests use this to control every boundary. */
export async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

/** Lets the queue's detached effects, mailbox round-trips, and cleanup barriers run to quiescence. */
export async function settle(rounds = 6): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await new Promise(resolve => setTimeout(resolve, 0));
}

/** Takes a promise's outcome immediately, so a rejection the test asserts later is never unhandled. */
export function capture<Value>(promise: Promise<Value>): Promise<Value | Error> {
  return promise.then(
    value => value,
    (error: unknown) => error as Error,
  );
}

/** Records the order in which the named events are published. */
export function record(distube: DisTube, names: readonly DisTubeEventName[]): string[] {
  const log: string[] = [];
  for (const name of names) distube.on(name, () => log.push(name));
  return log;
}

export function media(source: string, id = `${source}-song`): Song {
  return new Song({ id, name: `Title ${id}`, url: `https://${source}.example/media/${id}`, duration: 60, source });
}

/** A SourcePlugin whose every operation is a spy; tests override only what they exercise. */
export class FakeSource implements SourcePlugin {
  /** IDs of the Songs whose prepared resource was disposed, in disposal order. */
  readonly disposed: string[] = [];
  readonly initialize = vi.fn((_context: PluginContext) => undefined);
  readonly dispose = vi.fn(() => undefined);
  readonly search = vi.fn(async (_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> => []);
  readonly resolve = vi.fn(
    async (_url: string, _options?: SourceOperationOptions): Promise<Song | Playlist | undefined> => undefined,
  );
  readonly related = vi.fn(async (_song: Song, _context: RelatedContext): Promise<Song | undefined> => undefined);
  readonly stream = vi.fn(async (song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> =>
    this.resourceFor(song),
  );

  constructor(readonly name: string) {}

  /** A `url` preparation that records its own disposal, so tests can assert cleanup exactly once. */
  resourceFor(song: Song): PlaybackPreparation {
    return {
      kind: "resource",
      resource: {
        kind: "url",
        url: `https://stream.example/${song.id}`,
        seekable: true,
        dispose: () => {
          this.disposed.push(song.id);
        },
      },
    };
  }
}

export type FakePlayerOperation =
  /** Matches the next play or volume effect regardless of its argument; `play:${id}` targets one. */
  | "play"
  | `play:${string}`
  | "stop"
  | "pause"
  | "resume"
  | "seek"
  | "volume"
  | `volume:${string}`
  | "filters"
  | "gateway"
  | "release";

/** A deferred backend acknowledgement that reports when the effect reached the fake Player. */
export interface FakePlayerGate extends Deferred<void> {
  readonly entered: Promise<void>;
}

interface InternalFakePlayerGate extends FakePlayerGate {
  readonly markEntered: () => void;
}

/** A long-lived Player with controllable backend acknowledgements. */
/**
 * The voice sends the Player a unique per-play request ID of the form `<itemId>#<n>`. The fake reports the
 * caller's public ID everywhere a test reads it and translates public IDs back on `emit`, so tests speak
 * in item IDs; `requestIds` exposes the raw form for late-outcome cases.
 */
export function publicTrackId(requestId: string): string {
  return requestId.replace(/#\d+$/u, "");
}

export class FakePlayer implements Player {
  position = 0;
  /** Requests as the test sees them: `itemId` is the caller's public ID. */
  readonly requests: PlaybackRequest[] = [];
  /** Raw per-play request IDs in play order. */
  readonly requestIds: string[] = [];
  readonly renders: (readonly FilterEntry[])[] = [];
  readonly volumes: number[] = [];
  readonly calls: string[] = [];
  readonly listeners = new Set<(event: PlayerEvent) => void>();
  readonly #gates = new Map<FakePlayerOperation, InternalFakePlayerGate[]>();
  #currentItem?: string;
  #terminal = false;
  #releasePromise?: Promise<void>;

  readonly pause = vi.fn(async (): Promise<void> => this.#effect("pause"));
  readonly resume = vi.fn(async (): Promise<void> => this.#effect("resume"));
  readonly seek = vi.fn(async (_seconds: number): Promise<void> => this.#effect("seek"));
  readonly stopTrack = vi.fn(async (): Promise<void> => {
    await this.#effect("stop");
    this.#currentItem = undefined;
  });
  readonly play = vi.fn(async (request: PlaybackRequest): Promise<void> => {
    this.#assertOpen();
    const itemId = publicTrackId(request.itemId);
    this.requests.push({ ...request, itemId });
    this.requestIds.push(request.itemId);
    // The bare name matches any play; the keyed name matches only that item.
    await this.#effect("play", `play:${itemId}`);
    const keyed = this.#gates.get(`play:${itemId}`)?.shift();
    if (keyed) {
      keyed.markEntered();
      await keyed.promise;
    }
    this.#currentItem = request.itemId;
  });
  readonly setVolume = vi.fn(async (percent: number): Promise<void> => {
    await this.#effect("volume", `volume:${percent}`);
    const keyed = this.#gates.get(`volume:${percent}`)?.shift();
    if (keyed) {
      keyed.markEntered();
      await keyed.promise;
    }
    this.volumes.push(percent);
  });
  readonly setFilters = vi.fn(async (entries: readonly FilterEntry[]): Promise<void> => {
    await this.#effect("filters");
    this.renders.push(entries);
  });
  readonly release = vi.fn((): Promise<void> => {
    this.#terminal = true;
    this.#currentItem = undefined;
    this.listeners.clear();
    this.#releasePromise ??= this.#effect("release", "release", true);
    return this.#releasePromise;
  });
  readonly updateVoiceGateway = vi.fn(async (_gateway: VoiceGatewayData): Promise<void> => {
    await this.#effect("gateway");
  });

  /** Holds the next named backend operation until the returned gate settles. */
  gate(operation: FakePlayerOperation): FakePlayerGate {
    const completion = deferred<void>();
    let markEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      markEntered = resolve;
    });
    const gate: InternalFakePlayerGate = { ...completion, entered, markEntered };
    const gates = this.#gates.get(operation) ?? [];
    gates.push(gate);
    this.#gates.set(operation, gates);
    return gate;
  }

  /** The public ID of the item the Player has actually acknowledged as active. */
  get playing(): string | undefined {
    return this.#currentItem === undefined ? undefined : publicTrackId(this.#currentItem);
  }

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    if (this.#terminal) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publishes a native outcome. A public item ID names the latest request for that item; a raw request ID is used as is. */
  emit(event: PlayerEvent): void {
    if (this.#terminal) return;
    const outcome = event.type === "terminal" ? event : { ...event, itemId: this.#requestIdFor(event.itemId) };
    if (outcome.type !== "terminal" && this.#currentItem === outcome.itemId) this.#currentItem = undefined;
    for (const listener of Array.from(this.listeners)) listener(outcome);
  }

  /** Reports the active track as finished, the way a backend does when it runs out of media. */
  finish(): void {
    const itemId = this.#currentItem;
    if (itemId) this.emit({ type: "finished", itemId });
  }

  #requestIdFor(itemId: string): string {
    if (this.requestIds.includes(itemId)) return itemId;
    return this.requestIds.findLast(requestId => publicTrackId(requestId) === itemId) ?? itemId;
  }

  async #effect(operation: FakePlayerOperation, call: string = operation, terminal = false): Promise<void> {
    if (!terminal) this.#assertOpen();
    this.calls.push(call);
    const gate = this.#gates.get(operation)?.shift();
    if (gate) {
      gate.markEntered();
      await gate.promise;
    }
  }

  #assertOpen(): void {
    if (this.#terminal) throw new Error("Fake Player is retired");
  }
}

/** One guild's voice presence: it survives queue deletion and ends only when released or dropped. */
export class FakeVoiceSession implements VoiceSession {
  readonly clientUserId = "bot";
  channelId: string;
  readonly listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #releaseGates: Deferred<void>[] = [];
  /** Every voice state the session sent: the join state plus each runtime update. */
  readonly states: Required<JoinOptions>[] = [];
  selfDeaf = true;
  selfMute = false;
  readonly join = vi.fn(async (channelId: string, options: JoinOptions = {}): Promise<void> => {
    this.channelId = channelId;
    this.#record(options);
  });
  readonly setSelfDeaf = vi.fn(async (enabled: boolean): Promise<void> => {
    this.#record({ selfDeaf: enabled });
  });
  readonly setSelfMute = vi.fn(async (enabled: boolean): Promise<void> => {
    this.#record({ selfMute: enabled });
  });
  readonly release = vi.fn(async (): Promise<void> => {
    const gate = this.#releaseGates.shift();
    if (gate) await gate.promise;
  });

  constructor(
    readonly guildId: string,
    channelId: string,
    state: JoinOptions = {},
  ) {
    this.channelId = channelId;
    this.#record(state);
  }

  #record(options: JoinOptions): void {
    this.selfDeaf = options.selfDeaf ?? this.selfDeaf;
    this.selfMute = options.selfMute ?? this.selfMute;
    this.states.push({ selfDeaf: this.selfDeaf, selfMute: this.selfMute });
  }

  /** Holds the next session release until the returned gate settles. */
  gateRelease(): Deferred<void> {
    const gate = deferred<void>();
    this.#releaseGates.push(gate);
    return gate;
  }

  subscribe(listener: (event: VoiceSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publishes renewed platform gateway data. */
  connect(gateway: VoiceGatewayData, channelId = this.channelId): void {
    this.channelId = channelId;
    for (const listener of Array.from(this.listeners)) listener({ type: "connected", channelId, gateway });
  }

  /** Reports the terminal disconnect the Adapter would publish once its recovery policy is spent. */
  disconnect(error?: Error): void {
    for (const listener of Array.from(this.listeners)) listener({ type: "disconnected", ...(error ? { error } : {}) });
  }
}

/** The conventional presets with the ranges the official engines declare; the rest are fixed. */
export const FAKE_FILTERS: FilterDefinitions<string> = Object.freeze({
  ...Object.fromEntries(
    Object.values(Filters).map(name => [
      name,
      { render: () => name, label: name } satisfies FilterDefinitions<string>[string],
    ]),
  ),
  bassboost: {
    render: (value = 10) => `bass=g=${value}`,
    default: 10,
    min: 0,
    max: 20,
    label: (value = 10) => `Bass +${value}dB`,
  },
  nightcore: { render: () => "nightcore", label: "Nightcore" },
  vaporwave: { render: (value = 0.8) => `rate=${value}`, default: 0.8, min: 0.5, max: 1 },
});

/** Builds the metadata map an Engine exposes for `voice.filters.definitions`. */
export function filterInfo(definitions: FilterDefinitions<string>): ReadonlyMap<string, FilterDefinitionInfo> {
  return new Map(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      {
        ...(definition.default === undefined ? {} : { default: definition.default }),
        ...(definition.min === undefined ? {} : { min: definition.min }),
        ...(definition.max === undefined ? {} : { max: definition.max }),
        acceptsValue: definition.default !== undefined || definition.min !== undefined || definition.max !== undefined,
        label: (value?: number): string =>
          typeof definition.label === "function" ? definition.label(value) : (definition.label ?? name),
      },
    ]),
  );
}

export class FakeEngine implements Engine {
  readonly accepts: ReadonlySet<PlaybackResource["kind"]> = new Set(["url" as const]);
  readonly capabilities: Readonly<{ seek: boolean }>;
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  readonly players: FakePlayer[] = [];
  readonly #createGates: Deferred<Player>[] = [];
  readonly createPlayer = vi.fn(async (_session: VoiceSession): Promise<Player> => {
    const gate = this.#createGates.shift();
    const player = gate ? await gate.promise : new FakePlayer();
    if (player instanceof FakePlayer) this.players.push(player);
    return player;
  });

  /** Holds the next Player creation until the returned gate settles. */
  gateCreate(): Deferred<Player> {
    const gate = deferred<Player>();
    this.#createGates.push(gate);
    return gate;
  }

  constructor(definitions: FilterDefinitions<string> = FAKE_FILTERS, capabilities = { seek: true }) {
    this.filters = filterInfo(definitions);
    this.capabilities = Object.freeze({ ...capabilities });
  }
}

export class FakeAdapter implements Adapter {
  readonly normalizeTarget = (channel: VoiceChannelTarget): VoiceTarget => ({
    guildId: "guildId" in channel ? channel.guildId : channel.guild.id,
    channelId: channel.id,
  });
  readonly sessions: FakeVoiceSession[] = [];
  readonly #createGates: Deferred<VoiceSession>[] = [];
  readonly createVoiceSession = vi.fn(async (target: VoiceTarget, state: JoinOptions = {}): Promise<VoiceSession> => {
    const gate = this.#createGates.shift();
    const session = gate ? await gate.promise : new FakeVoiceSession(target.guildId, target.channelId, state);
    if (session instanceof FakeVoiceSession) this.sessions.push(session);
    return session;
  });

  /** Holds the next session creation until the returned gate settles. */
  gateCreateSession(): Deferred<VoiceSession> {
    const gate = deferred<VoiceSession>();
    this.#createGates.push(gate);
    return gate;
  }

  constructor(readonly engine: Engine = new FakeEngine()) {}
}

export const GUILD = "guild";
export const VOICE_CHANNEL = "voice";

export interface Harness {
  readonly adapter: FakeAdapter;
  readonly engine: FakeEngine;
  readonly diagnostics: ReturnType<typeof vi.fn<(diagnostic: Diagnostic) => void>>;
  readonly distube: DisTube;
}

export interface HarnessOptions {
  readonly sources?: readonly SourcePlugin[];
  readonly engine?: FakeEngine;
  /** Adapter override for tests that fail or defer session creation. */
  readonly adapter?: FakeAdapter;
  readonly historySize?: number;
}

export function setup(sources: readonly SourcePlugin[], options: HarnessOptions = {}): Harness {
  const engine = options.engine ?? new FakeEngine();
  const adapter = options.adapter ?? new FakeAdapter(engine);
  const diagnostics = vi.fn<(diagnostic: Diagnostic) => void>();
  const distube = new DisTube({
    adapter,
    sources: [...sources, ...(options.sources ?? [])],
    ...(options.historySize === undefined ? {} : { historySize: options.historySize }),
    onDiagnostic: diagnostics,
  });
  return { adapter, engine, diagnostics, distube };
}

/** The absolute URL form of a media id, for tests that exercise URL routing rather than query search. */
export function mediaUrl(id: string, source = "source"): string {
  return `https://${source}.example/media/${id}`;
}

/** The id a harness input names, whether it arrived as a bare id or as its `mediaUrl` form. */
function idOf(input: string): string {
  return input.startsWith("https://") ? (input.split("/").pop() as string) : input;
}

/**
 * A single-source harness whose plugin answers for every input, by URL or by query.
 *
 * Core routes an absolute URL to `resolve` and everything else to `search`, so a test picks which path
 * it exercises by passing `mediaUrl("a")` or plain `"a"`. Both produce the Song named `a`.
 */
export function playableSetup(name = "source"): Harness & { readonly source: FakeSource } {
  const source = new FakeSource(name);
  source.resolve.mockImplementation(async url => media(name, idOf(url)));
  source.search.mockImplementation(async query => [media(name, idOf(query))]);
  return { ...setup([source]), source };
}

/** A listener that unregisters its own exact registration before invoking the test callback. */
export function once<Name extends DisTubeEventName>(
  distube: DisTube,
  name: Name,
  listener: DisTubeEventListener<Name>,
): () => void {
  const unsubscribe = distube.on(name, event => {
    unsubscribe();
    return listener(event);
  });
  return unsubscribe;
}

/** Fails a fixture at the missing value, preserving its narrowed type for the assertions below. */
export function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}
