import { vi } from "vitest";
import {
  type Diagnostic,
  DisTube,
  type DisTubeEventListener,
  type DisTubeEventMap,
  type DisTubeEventName,
  type DisTubeOptions,
  type Playlist,
  Song,
  type VoiceChannelTarget,
} from "../../src";
import type {
  Adapter,
  Engine,
  EngineSettings,
  FilterDefinitionInfo,
  FilterDefinitions,
  FilterEntry,
  JoinOptions,
  PlaybackResource,
  Player,
  PlayerOptions,
  Plugin,
  RelatedOptions,
  ResolveOptions,
  SearchOptions,
  TrackEnd,
  TrackOptions,
  VoiceGatewayData,
  VoiceSession,
  VoiceSessionEvent,
  VoiceSessionOptions,
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

/** Advances Promise jobs without yielding to timers. */
export async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let round = 0; round < rounds; round += 1) await Promise.resolve();
}

/** Lets detached loop work and event delivery run to quiescence. */
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

/** Records the reason of every `queue.deleted`, in publication order. */
export function deletions<Metadata>(distube: DisTube<Metadata>): string[] {
  const reasons: string[] = [];
  distube.on("queue.deleted", event => void reasons.push(event.reason));
  return reasons;
}

/** Records the order in which the named events are published. */
export function record<Metadata>(distube: DisTube<Metadata>, names: readonly DisTubeEventName[]): string[] {
  const log: string[] = [];
  for (const name of names) distube.on(name, () => log.push(name));
  return log;
}

/** Records every `queue.updated` payload, in publication order. */
export function updates<Metadata>(distube: DisTube<Metadata>): DisTubeEventMap<Metadata>["queue.updated"][] {
  const published: DisTubeEventMap<Metadata>["queue.updated"][] = [];
  distube.on("queue.updated", event => void published.push(event));
  return published;
}

export function media(source: string, id = `${source}-song`): Song {
  return new Song({ id, name: `Title ${id}`, url: `https://${source}.example/media/${id}`, duration: 60, source });
}

/** A Plugin whose every operation is a spy; tests override only what they exercise. */
export class FakeSource implements Plugin {
  /** IDs of the Songs whose prepared resource was disposed, in disposal order. */
  readonly disposed: string[] = [];
  readonly dispose = vi.fn(() => undefined);
  readonly search = vi.fn(async (_query: string, _options: SearchOptions): Promise<readonly Song[]> => []);
  readonly resolve = vi.fn(
    async (_url: string, _options: ResolveOptions): Promise<Song | Playlist | undefined> => undefined,
  );
  readonly related = vi.fn(async (_song: Song, _options: RelatedOptions): Promise<Song | undefined> => undefined);
  readonly stream = vi.fn(async (song: Song, _options: { signal: AbortSignal }): Promise<PlaybackResource> =>
    this.resource(song.id),
  );

  constructor(readonly name: string) {}

  /** A seekable `file` resource that records its own disposal, so tests can assert cleanup exactly once. */
  resource(id: string): PlaybackResource {
    return {
      kind: "file",
      path: `/stream/${id}`,
      dispose: () => {
        this.disposed.push(id);
      },
    };
  }
}

export type FakePlayerOperation =
  | "play"
  | `play:${string}`
  | "stop"
  | "pause"
  | "resume"
  | "seek"
  | "volume"
  | "filters"
  | "release";

/** A deferred backend acknowledgement that reports when the effect reached the fake Player. */
export interface FakePlayerGate extends Deferred<void> {
  readonly entered: Promise<void>;
}

interface ActiveTrack {
  readonly id: string;
  readonly end: Deferred<TrackEnd>;
}

/** The id a fake resource names: the last segment of its URL or path. */
export function resourceId(resource: PlaybackResource): string {
  const location = resource.kind === "url" ? resource.url : resource.kind === "file" ? resource.path : undefined;
  return location === undefined ? resource.kind : (location.split("/").pop() as string);
}

/**
 * A Player that follows the contract: a second play settles the first `replaced`, an aborted signal,
 * `stopTrack` or `release` settles it `stopped`. Tests end tracks with `finish` or `fail`.
 */
export class FakePlayer implements Player {
  position = 0;
  /** Resource ids in play order. */
  readonly played: string[] = [];
  readonly renders: (readonly FilterEntry[])[] = [];
  readonly volumes: number[] = [];
  readonly calls: string[] = [];
  readonly #gates = new Map<FakePlayerOperation, (FakePlayerGate & { markEntered: () => void })[]>();
  #track?: ActiveTrack;
  #released = false;

  readonly pause = vi.fn(async (): Promise<void> => this.#effect("pause"));
  readonly resume = vi.fn(async (): Promise<void> => this.#effect("resume"));
  readonly seek = vi.fn(async (_seconds: number): Promise<void> => this.#effect("seek"));
  readonly stopTrack = vi.fn(async (): Promise<void> => {
    await this.#effect("stop");
    this.#end({ reason: "stopped" });
  });
  readonly play = vi.fn(async (resource: PlaybackResource, options: TrackOptions): Promise<TrackEnd> => {
    this.#assertOpen();
    const id = resourceId(resource);
    this.#end({ reason: "replaced" });
    const track: ActiveTrack = { id, end: deferred<TrackEnd>() };
    this.#track = track;
    this.played.push(id);
    const stop = (): void => {
      if (this.#track === track) this.#end({ reason: "stopped" });
    };
    if (options.signal.aborted) stop();
    options.signal.addEventListener("abort", stop, { once: true });
    void (async () => {
      await this.#effect("play", `play:${id}`);
      const keyed = this.#gates.get(`play:${id}`)?.shift();
      if (keyed) {
        keyed.markEntered();
        await keyed.promise;
      }
      if (this.#track === track) options.onStart();
    })().catch((error: unknown) => {
      if (this.#track === track) this.fail(error);
    });
    return track.end.promise;
  });
  readonly setVolume = vi.fn(async (percent: number): Promise<void> => {
    await this.#effect("volume", `volume:${percent}`);
    this.volumes.push(percent);
  });
  readonly setFilters = vi.fn(async (entries: readonly FilterEntry[]): Promise<void> => {
    await this.#effect("filters");
    this.renders.push(entries);
  });
  readonly release = vi.fn(async (): Promise<void> => {
    this.#released = true;
    this.#end({ reason: "stopped" });
    await this.#effect("release", "release", true);
  });
  readonly updateVoiceGateway = vi.fn(async (_gateway: VoiceGatewayData): Promise<void> => undefined);
  onClosed?: PlayerOptions["onClosed"];

  /** Holds the next named backend operation until the returned gate settles. */
  gate(operation: FakePlayerOperation): FakePlayerGate {
    const completion = deferred<void>();
    let markEntered!: () => void;
    const entered = new Promise<void>(resolve => {
      markEntered = resolve;
    });
    const gate = { ...completion, entered, markEntered };
    const gates = this.#gates.get(operation) ?? [];
    gates.push(gate);
    this.#gates.set(operation, gates);
    return gate;
  }

  /** The id of the resource currently playing. */
  get playing(): string | undefined {
    return this.#track?.id;
  }

  /** Ends the active track the way a backend does when it runs out of media. */
  finish(): void {
    this.#end({ reason: "finished" });
  }

  /** Closes the Player on its own, as a destroyed native connection does: reports it, then rejects the track. */
  close(error: Error): void {
    this.#released = true;
    this.onClosed?.(error);
    this.fail(error);
  }

  /** Fails the active track. */
  fail(error: unknown): void {
    const track = this.#track;
    this.#track = undefined;
    track?.end.reject(error);
  }

  #end(end: TrackEnd): void {
    const track = this.#track;
    this.#track = undefined;
    track?.end.resolve(end);
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
    if (this.#released) throw new Error("Fake Player is released");
  }
}

/** One guild's voice presence: it survives queue deletion and ends only when released or dropped. */
export class FakeVoiceSession implements VoiceSession {
  readonly clientUserId = "bot";
  bitrate = 64_000;
  channelId: string;
  selfDeaf: boolean;
  selfMute: boolean;
  readonly listeners = new Set<(event: VoiceSessionEvent) => void>();
  /** Every voice state the session sent: the creation state plus each join and flag write. */
  readonly states: Required<JoinOptions>[] = [];
  readonly #releaseGates: Deferred<void>[] = [];
  readonly #joinGates: Deferred<void>[] = [];
  readonly join = vi.fn(async (channelId: string, options: JoinOptions = {}): Promise<void> => {
    const gate = this.#joinGates.shift();
    if (gate) await gate.promise;
    this.channelId = channelId;
    this.selfDeaf = options.selfDeaf ?? this.selfDeaf;
    this.selfMute = options.selfMute ?? this.selfMute;
    this.states.push({ selfDeaf: this.selfDeaf, selfMute: this.selfMute });
  });
  readonly setSelfState = vi.fn(async (state: JoinOptions): Promise<void> => {
    this.selfDeaf = state.selfDeaf ?? this.selfDeaf;
    this.selfMute = state.selfMute ?? this.selfMute;
    this.states.push({ selfDeaf: this.selfDeaf, selfMute: this.selfMute });
  });
  readonly voiceClosed = vi.fn((_code: number): void => undefined);
  readonly rejoin = vi.fn(async (): Promise<void> => undefined);
  readonly release = vi.fn(async (): Promise<void> => {
    const gate = this.#releaseGates.shift();
    if (gate) await gate.promise;
  });

  constructor(
    readonly guildId: string,
    channelId: string,
    options: Pick<VoiceSessionOptions, "selfDeaf" | "selfMute"> = { selfDeaf: true, selfMute: false },
  ) {
    this.channelId = channelId;
    this.selfDeaf = options.selfDeaf;
    this.selfMute = options.selfMute;
    this.states.push({ selfDeaf: this.selfDeaf, selfMute: this.selfMute });
  }

  /** Holds the acknowledgement of the next join until the returned gate settles. */
  gateJoin(): Deferred<void> {
    const gate = deferred<void>();
    this.#joinGates.push(gate);
    return gate;
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

  connect(gateway: VoiceGatewayData, channelId = this.channelId): void {
    this.channelId = channelId;
    for (const listener of Array.from(this.listeners)) listener({ type: "connected", channelId, gateway });
  }

  /** With an error, the Adapter's recovery policy is spent; without one, the platform removed the bot. */
  disconnect(error?: Error): void {
    const event: VoiceSessionEvent = error
      ? { type: "disconnected", reason: "failed", error }
      : { type: "disconnected", reason: "removed" };
    for (const listener of Array.from(this.listeners)) listener(event);
  }
}

/** The conventional filter names every official engine ships a default definition for. */
const FILTER_NAMES = [
  "3d",
  "bassboost",
  "earwax",
  "echo",
  "flanger",
  "gate",
  "haas",
  "karaoke",
  "mcompand",
  "nightcore",
  "phaser",
  "surround",
  "tremolo",
  "vaporwave",
] as const;

/** The conventional presets with the ranges the official engines declare; the rest are fixed. */
export const FAKE_FILTERS: FilterDefinitions<string> = Object.freeze({
  ...Object.fromEntries(
    FILTER_NAMES.map(name => [name, { render: () => name, label: name } satisfies FilterDefinitions<string>[string]]),
  ),
  bassboost: { render: (value = 10) => `bass=g=${value}`, default: 10, min: 0, max: 20, label: "Bass boost" },
  nightcore: { render: () => "nightcore", label: "Nightcore" },
  vaporwave: { render: (value = 0.8) => `rate=${value}`, default: 0.8, min: 0.5, max: 1 },
});

export function filterInfo(definitions: FilterDefinitions<string>): ReadonlyMap<string, FilterDefinitionInfo> {
  return new Map(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      {
        ...(definition.default === undefined ? {} : { default: definition.default }),
        ...(definition.min === undefined ? {} : { min: definition.min }),
        ...(definition.max === undefined ? {} : { max: definition.max }),
        acceptsValue: definition.default !== undefined || definition.min !== undefined || definition.max !== undefined,
        label: definition.label ?? name,
      },
    ]),
  );
}

export class FakeEngine implements Engine {
  readonly filters: ReadonlyMap<string, FilterDefinitionInfo>;
  readonly players: FakePlayer[] = [];
  readonly #createGates: Deferred<Player>[] = [];
  readonly createPlayer = vi.fn(async (_session: VoiceSession, options: PlayerOptions): Promise<Player> => {
    const gate = this.#createGates.shift();
    const player = gate ? await gate.promise : new FakePlayer();
    if (player instanceof FakePlayer) {
      player.onClosed = options.onClosed;
      this.players.push(player);
    }
    return player;
  });

  constructor(definitions: FilterDefinitions<string> = FAKE_FILTERS) {
    this.filters = filterInfo(definitions);
  }

  /** Holds the next Player creation until the returned gate settles. */
  gateCreate(): Deferred<Player> {
    const gate = deferred<Player>();
    this.#createGates.push(gate);
    return gate;
  }

  get player(): FakePlayer {
    return required(this.players.at(-1));
  }
}

/** An engine that prepares every Song itself, like Lavalink. */
export class PreparingEngine extends FakeEngine {
  readonly prepare = vi.fn(async (song: Song, _options: { signal: AbortSignal }): Promise<PlaybackResource> => ({
    kind: "encoded",
    format: "fake",
    encoded: song.id,
  }));
}

export class FakeAdapter implements Adapter {
  readonly normalizeTarget = (channel: VoiceChannelTarget): VoiceTarget => ({
    guildId: "guildId" in channel ? channel.guildId : channel.guild.id,
    channelId: channel.id,
  });
  readonly sessions: FakeVoiceSession[] = [];
  readonly settings: EngineSettings[] = [];
  readonly #createGates: Deferred<VoiceSession>[] = [];
  readonly createVoiceSession = vi.fn(
    async (target: VoiceTarget, options: VoiceSessionOptions): Promise<VoiceSession> => {
      const gate = this.#createGates.shift();
      const session = gate ? await gate.promise : new FakeVoiceSession(target.guildId, target.channelId, options);
      if (session instanceof FakeVoiceSession) this.sessions.push(session);
      return session;
    },
  );
  readonly createEngine = vi.fn((settings: EngineSettings): Engine => {
    this.settings.push(settings);
    return this.engine;
  });

  constructor(readonly engine: Engine = new FakeEngine()) {}

  /** Holds the next session creation until the returned gate settles. */
  gateCreateSession(): Deferred<VoiceSession> {
    const gate = deferred<VoiceSession>();
    this.#createGates.push(gate);
    return gate;
  }

  get session(): FakeVoiceSession {
    return required(this.sessions.at(-1));
  }
}

export const GUILD = "guild";
export const VOICE_CHANNEL = "voice";
export const CHANNEL: VoiceChannelTarget = { id: VOICE_CHANNEL, guildId: GUILD };

export interface Harness<Metadata = undefined> {
  readonly adapter: FakeAdapter;
  readonly engine: FakeEngine;
  readonly diagnostics: ReturnType<typeof vi.fn<(diagnostic: Diagnostic) => void>>;
  readonly distube: DisTube<Metadata>;
}

export interface HarnessOptions extends Partial<Omit<DisTubeOptions, "adapter" | "plugins" | "engine">> {
  readonly engine?: FakeEngine;
  readonly adapter?: FakeAdapter;
  readonly tuning?: DisTubeOptions["engine"];
}

export function setup<Metadata = undefined>(
  plugins: readonly Plugin[],
  options: HarnessOptions = {},
): Harness<Metadata> {
  const { engine: fakeEngine, adapter: fakeAdapter, tuning, ...rest } = options;
  const engine = fakeEngine ?? new FakeEngine();
  const adapter = fakeAdapter ?? new FakeAdapter(engine);
  const diagnostics = vi.fn<(diagnostic: Diagnostic) => void>();
  const distube = new DisTube<Metadata>({
    adapter,
    plugins,
    onDiagnostic: diagnostics,
    ...rest,
    ...(tuning ? { engine: tuning } : {}),
  });
  return { adapter, engine, diagnostics, distube };
}

/** The absolute URL form of a media id, for tests that exercise URL routing rather than query search. */
export function mediaUrl(id: string, source = "source"): string {
  return `https://${source}.example/media/${id}`;
}

function idOf(input: string): string {
  return input.startsWith("https://") ? (input.split("/").pop() as string) : input;
}

/** A single-source harness whose plugin answers every input: a URL through `resolve`, a query through `search`. */
export function playableSetup<Metadata = undefined>(
  name = "source",
  options: HarnessOptions = {},
): Harness<Metadata> & { readonly source: FakeSource } {
  const source = new FakeSource(name);
  source.resolve.mockImplementation(async url => media(name, idOf(url)));
  source.search.mockImplementation(async query => [media(name, idOf(query))]);
  return { ...setup<Metadata>([source], options), source };
}

/** Starts playback of `ids` in order and waits until the first one is playing. */
export async function playing(harness: Harness, ...ids: string[]): Promise<FakePlayer> {
  for (const id of ids) await harness.distube.play(CHANNEL, id);
  await settle();
  return harness.engine.player;
}

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

export function required<Value>(value: Value | undefined): Value {
  if (value === undefined) throw new Error("Expected fixture value");
  return value;
}

/** The error a synchronous command throws, for assertions on its code and cause. */
export function thrown(action: () => unknown): unknown {
  try {
    action();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("Expected the action to throw");
}
