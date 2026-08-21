import { vi } from "vitest";
import {
  type Adapter,
  type Diagnostic,
  DisTube,
  type DisTubeEventName,
  type Engine,
  type FilterEntry,
  Filters,
  type PlaybackContext,
  type PlaybackPreparation,
  type PlaybackRequest,
  type Player,
  type PlayerEvent,
  type Playlist,
  type Plugin,
  type PluginContext,
  type RelatedContext,
  Song,
  type SourceOperationOptions,
  type SourcePlugin,
  type VoiceGatewayData,
  type VoiceSession,
  type VoiceSessionEvent,
  type VoiceTarget,
} from "../../src";

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
  return new Song({ id, title: `Title ${id}`, url: `https://${source}.example/media/${id}`, duration: 60, source });
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
  readonly preparePlayback = vi.fn(
    async (song: Song, _context: PlaybackContext): Promise<PlaybackPreparation> => this.resourceFor(song),
  );

  constructor(readonly name: string) {}

  /** A `url` preparation that records its own disposal, so tests can assert cleanup exactly once. */
  resourceFor(song: Song): PlaybackPreparation {
    return {
      kind: "resource",
      resource: {
        kind: "url",
        url: `https://stream.example/${song.id}`,
        dispose: () => {
          this.disposed.push(song.id);
        },
      },
    };
  }
}

export type FakePlayerOperation =
  | "play"
  | "stop"
  | "pause"
  | "resume"
  | "seek"
  | "volume"
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
export class FakePlayer implements Player {
  position = 0;
  readonly requests: PlaybackRequest[] = [];
  readonly renders: (readonly FilterEntry[])[] = [];
  readonly volumes: number[] = [];
  readonly gateways: VoiceGatewayData[] = [];
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
    this.requests.push(request);
    await this.#effect("play", `play:${request.itemId}`);
    this.#currentItem = request.itemId;
  });
  readonly setVolume = vi.fn(async (percent: number): Promise<void> => {
    await this.#effect("volume", `volume:${percent}`);
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
  readonly updateVoiceGateway = vi.fn(async (gateway: VoiceGatewayData): Promise<void> => {
    await this.#effect("gateway");
    this.gateways.push(gateway);
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

  /** The item the Player has actually acknowledged as active. */
  get playing(): string | undefined {
    return this.#currentItem;
  }

  subscribe(listener: (event: PlayerEvent) => void): () => void {
    if (this.#terminal) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Publishes a native outcome to whichever queue currently holds the borrow. */
  emit(event: PlayerEvent): void {
    if (this.#terminal) return;
    if (this.#currentItem === event.itemId) this.#currentItem = undefined;
    for (const listener of [...this.listeners]) listener(event);
  }

  /** Reports the active track as finished, the way a backend does when it runs out of media. */
  finish(): void {
    const itemId = this.playing;
    if (itemId) this.emit({ type: "finished", itemId });
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
  channelId: string;
  gateway?: VoiceGatewayData;
  readonly listeners = new Set<(event: VoiceSessionEvent) => void>();
  readonly #releaseGates: Deferred<void>[] = [];
  readonly join = vi.fn(async (channelId: string): Promise<void> => {
    this.channelId = channelId;
  });
  readonly release = vi.fn(async (): Promise<void> => {
    const gate = this.#releaseGates.shift();
    if (gate) await gate.promise;
  });

  constructor(
    readonly guildId: string,
    channelId: string,
  ) {
    this.channelId = channelId;
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
    this.gateway = gateway;
    this.channelId = channelId;
    for (const listener of [...this.listeners]) listener({ type: "connected", channelId, gateway });
  }

  /** Reports the terminal disconnect the Adapter would publish once its recovery policy is spent. */
  disconnect(error?: Error): void {
    for (const listener of [...this.listeners]) listener({ type: "disconnected", ...(error ? { error } : {}) });
  }
}

export class FakeEngine implements Engine {
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

  constructor(private readonly presets: ReadonlySet<string> = new Set(Object.values(Filters))) {}

  resolvable(name: string): boolean {
    return this.presets.has(name);
  }
}

export class FakeAdapter implements Adapter {
  readonly sessions: FakeVoiceSession[] = [];
  readonly #createGates: Deferred<VoiceSession>[] = [];
  readonly createVoiceSession = vi.fn(async (target: VoiceTarget): Promise<VoiceSession> => {
    const gate = this.#createGates.shift();
    const session = gate ? await gate.promise : new FakeVoiceSession(target.guildId, target.channelId);
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
  readonly plugins?: readonly Plugin[];
  readonly engine?: FakeEngine;
  /** Adapter override for tests that fail or defer session creation. */
  readonly adapter?: FakeAdapter;
}

export function setup(sources: readonly Plugin[], options: HarnessOptions = {}): Harness {
  const engine = options.engine ?? new FakeEngine();
  const adapter = options.adapter ?? new FakeAdapter(engine);
  const diagnostics = vi.fn<(diagnostic: Diagnostic) => void>();
  const distube = new DisTube({
    adapter,
    plugins: [...sources, ...(options.plugins ?? [])],
    onDiagnostic: diagnostics,
  });
  return { adapter, engine, diagnostics, distube };
}

/** A single-source harness whose plugin resolves every URL into a Song named after it. */
export function playableSetup(name = "source"): Harness & { readonly source: FakeSource } {
  const source = new FakeSource(name);
  source.resolve.mockImplementation(async url => media(name, url));
  return { ...setup([source]), source };
}
