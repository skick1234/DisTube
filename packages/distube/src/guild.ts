import type {
  Adapter,
  Engine,
  FilterEntry,
  JoinOptions,
  PlaybackResource,
  Player,
  Plugin,
  TrackEnd,
  VoiceSession,
  VoiceSessionEvent,
} from "./contracts";
import { abortError, DisTubeError, ErrorCode, toDisTubeError } from "./errors";
import type { DisTubeEvents, VoiceDisconnectReason } from "./events";
import { NO_FILTERS } from "./filters";
import { DisTubeQueue } from "./queue";
import { disposeResource } from "./sources";
import { DisTubeVoice, type VoiceJoinOptions } from "./voice";

export interface GuildConfig<Target> {
  readonly adapter: Adapter<Target>;
  readonly engine: Engine;
  readonly plugins: readonly Plugin[];
  readonly events: DisTubeEvents<Target>;
  readonly historySize: number;
  readonly maxPlaylistSongs: number;
  readonly connectionTimeoutMs: number;
  readonly lifetime: AbortSignal;
}

export interface Connection {
  readonly session: VoiceSession;
  channelId: string;
  volume: number;
  entries: readonly FilterEntry[];
  rate: number;
  player?: Promise<Player>;
  settings: Promise<unknown>;
  channel: Promise<unknown>;
  unsubscribe: () => void;
  closed: boolean;
  closing?: Promise<void>;
}

interface Live<Target> {
  readonly connection: Connection;
  readonly voice: DisTubeVoice<Target>;
}

interface PendingJoin<Target> {
  readonly waiters: (AbortSignal | undefined)[];
  readonly controller: AbortController;
  readonly voice: Promise<DisTubeVoice<Target>>;
}

interface Track {
  readonly connection: Connection;
  readonly resource: PlaybackResource;
  readonly controller: AbortController;
  readonly stop: AbortSignal;
  readonly disposed: PromiseWithResolvers<void>;
  player?: Player;
  paused: boolean;
}

const STOPPED: TrackEnd = Object.freeze({ reason: "stopped" });
const DEFAULT_VOLUME = 100;

export class Guilds<Target> {
  readonly queues = new Map<string, DisTubeQueue<unknown, Target>>();
  readonly voices = new Map<string, DisTubeVoice<Target>>();
  readonly work = new Set<Promise<unknown>>();
  readonly config: GuildConfig<Target>;
  readonly #guilds = new Map<string, Guild<Target>>();

  constructor(config: GuildConfig<Target>) {
    this.config = config;
  }

  get(guildId: string): Guild<Target> | undefined {
    return this.#guilds.get(guildId);
  }

  ensure(guildId: string): Guild<Target> {
    const existing = this.#guilds.get(guildId);
    if (existing) return existing;
    const guild = new Guild(this, guildId);
    this.#guilds.set(guildId, guild);
    return guild;
  }

  forget(guild: Guild<Target>): void {
    if (this.#guilds.get(guild.id) === guild) this.#guilds.delete(guild.id);
  }

  track(work: Promise<unknown>): void {
    this.work.add(work);
    const forget = (): void => {
      this.work.delete(work);
    };
    work.then(forget, forget);
  }

  async close(): Promise<readonly unknown[]> {
    const failures = await Promise.all([...this.#guilds.values()].map(guild => guild.shutdown()));
    return failures.flat();
  }
}

export class Guild<Target> {
  readonly id: string;
  readonly guilds: Guilds<Target>;
  queue?: DisTubeQueue<unknown, Target>;
  #live?: Live<Target>;
  #join?: PendingJoin<Target>;
  #leaving?: Promise<void>;
  #track?: Track;

  constructor(guilds: Guilds<Target>, id: string) {
    this.guilds = guilds;
    this.id = id;
  }

  get config(): GuildConfig<Target> {
    return this.guilds.config;
  }

  get voice(): DisTubeVoice<Target> | undefined {
    return this.#live?.voice;
  }

  get joining(): boolean {
    return this.#join !== undefined;
  }

  get paused(): boolean {
    return this.#track?.paused ?? false;
  }

  get position(): number {
    return this.#track?.player?.position ?? 0;
  }

  get playbackRate(): number {
    return this.#live?.connection.rate ?? 1;
  }

  createQueue(): DisTubeQueue<unknown, Target> {
    const queue = new DisTubeQueue<unknown, Target>(this);
    this.queue = queue;
    this.guilds.queues.set(this.id, queue);
    return queue;
  }

  unregister(queue: DisTubeQueue<unknown, Target>): void {
    if (this.queue !== queue) return;
    this.queue = undefined;
    this.guilds.queues.delete(this.id);
    this.#forgetIfIdle();
  }

  connect(channelId: string, options: VoiceJoinOptions): Promise<DisTubeVoice<Target>> {
    if (this.#live) return Promise.resolve(this.#live.voice);
    const pending = this.#join;
    if (pending) {
      pending.waiters.push(options.signal);
      return raceSignal(pending.voice, options.signal);
    }
    const waiters = [options.signal];
    const controller = new AbortController();
    const voice = this.#create(channelId, options, waiters, controller.signal);
    this.#join = { waiters, controller, voice };
    return raceSignal(voice, options.signal);
  }

  leave(): Promise<void> {
    const join = this.#join;
    this.#join = undefined;
    join?.controller.abort();
    if (join) {
      const leaving = join.voice.then(
        () => undefined,
        () => undefined,
      );
      this.#leaving = leaving;
      void leaving.then(() => this.#left(leaving));
    }
    void this.queue?.delete("leave");
    return this.#live ? this.#end(this.#live.connection, "left") : (this.#leaving ?? Promise.resolve());
  }

  leaveFrom(connection: Connection): Promise<void> {
    return this.#live?.connection === connection ? this.leave() : this.#close(connection);
  }

  async shutdown(): Promise<readonly unknown[]> {
    const join = this.#join;
    this.#join = undefined;
    join?.controller.abort();
    const leaving = this.#leaving;
    const ending = this.#live && this.#end(this.#live.connection, "shutdown");
    const closes = await Promise.allSettled([leaving, ending]);
    await join?.voice.catch(() => undefined);
    return closes.flatMap(close => (close.status === "rejected" ? [close.reason] : []));
  }

  async playTrack(resource: PlaybackResource, signal: AbortSignal, onStart: () => void): Promise<TrackEnd> {
    const previous = this.#track;
    const connection = this.#live?.connection;
    if (!connection) {
      await disposeResource(resource).catch((error: unknown) => this.#report("voice.resource.dispose", error));
      throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeVoice is no longer connected");
    }
    const controller = new AbortController();
    const track: Track = {
      connection,
      resource,
      controller,
      stop: AbortSignal.any([signal, controller.signal]),
      disposed: Promise.withResolvers(),
      paused: false,
    };
    let reading: Promise<unknown> = Promise.resolve();
    const inherited = connection.player;
    const creation = this.#ensurePlayer(connection);
    this.#track = track;
    try {
      const player = await raceSignal(
        inherited
          ? creation.catch((error: unknown) => {
              if (track.stop.aborted) throw error;
              return this.#ensurePlayer(connection);
            })
          : creation,
        track.stop,
      );
      await previous?.disposed.promise;
      const early = interruption(track, signal);
      if (early) return early;
      track.player = player;
      const playing = player.play(resource, { signal: track.stop, onStart });
      reading = playing.catch(() => undefined);
      const outcome = await playing;
      return interruption(track, signal) ?? outcome;
    } catch (error: unknown) {
      const end = interruption(track, signal);
      if (end) return end;
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to play the track", error);
    } finally {
      if (this.#track === track) this.#track = undefined;
      await reading
        .then(() => disposeResource(resource))
        .catch((error: unknown) => this.#report("voice.resource.dispose", error));
      track.disposed.resolve();
    }
  }

  async setPaused(paused: boolean): Promise<boolean> {
    const { track, player } = this.#startedTrack();
    return this.#serial(track.connection, async () => {
      if (this.#ended(track))
        throw new DisTubeError(ErrorCode.INVALID_STATE, "The item ended before the pause applied");
      if (track.paused === paused) return false;
      await call(paused ? "Player failed to pause" : "Player failed to resume", () =>
        paused ? player.pause() : player.resume(),
      );
      track.paused = paused;
      return true;
    });
  }

  async seek(seconds: number): Promise<void> {
    const { track, player } = this.#startedTrack();
    if (!seekable(track.resource)) throw new DisTubeError(ErrorCode.UNSUPPORTED, "The current item cannot seek");
    try {
      await player.seek(seconds);
    } catch (error: unknown) {
      if (this.#ended(track))
        throw new DisTubeError(ErrorCode.INVALID_STATE, "The item ended before the seek applied", { cause: error });
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to seek", error);
    }
  }

  setVolume(connection: Connection, percent: number): Promise<void> {
    return this.#setting(connection, "Player failed to set volume", async player => {
      await player?.setVolume(percent);
      const changed = connection.volume !== percent;
      connection.volume = percent;
      if (changed) this.#settingsChanged(connection);
    });
  }

  setFilters(
    connection: Connection,
    change: (entries: readonly FilterEntry[]) => readonly FilterEntry[],
  ): Promise<void> {
    return this.#setting(connection, "Player failed to render filters", async player => {
      const entries = change(connection.entries);
      const rate = playbackRate(this.config.engine, entries);
      await player?.setFilters(entries);
      const changed = !sameFilters(connection.entries, entries);
      connection.entries = entries;
      connection.rate = rate;
      if (changed) this.#settingsChanged(connection);
    });
  }

  setSelfState(connection: Connection, state: JoinOptions): Promise<void> {
    return this.#onChannel(connection, async () => {
      assertOpen(connection);
      await call("Adapter failed to update the voice state", () => connection.session.setSelfState(state));
    });
  }

  async move(connection: Connection, channelId: string): Promise<void> {
    assertOpen(connection);
    await this.#onChannel(connection, async () => {
      if (channelId === connection.channelId) return;
      assertOpen(connection);
      await call("Adapter failed to update the voice session", () => connection.session.join(channelId));
      connection.channelId = channelId;
    });
  }

  async #create(
    channelId: string,
    options: VoiceJoinOptions,
    waiters: readonly (AbortSignal | undefined)[],
    abort: AbortSignal,
  ): Promise<DisTubeVoice<Target>> {
    let session: VoiceSession;
    try {
      await this.#leaving?.catch(() => undefined);
      abort.throwIfAborted();
      session = await this.config.adapter.createVoiceSession(
        { guildId: this.id, channelId },
        {
          selfDeaf: options.selfDeaf ?? true,
          selfMute: options.selfMute ?? false,
          timeoutMs: this.config.connectionTimeoutMs,
          signal: abort,
        },
      );
    } catch (error: unknown) {
      this.#dropJoin(waiters);
      if (abort.aborted) throw new DisTubeError(ErrorCode.INVALID_STATE, "Voice join was superseded");
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "Adapter failed to create the voice session", error);
    }
    const superseded = abort.aborted;
    if (superseded || waiters.every(signal => signal?.aborted)) {
      this.#dropJoin(waiters);
      await session.release().catch((error: unknown) => this.#report("voice.session.release", error));
      if (superseded) throw new DisTubeError(ErrorCode.INVALID_STATE, "Voice join was superseded");
      throw abortError(waiters[0] as AbortSignal);
    }
    this.#join = undefined;
    const connection: Connection = {
      session,
      channelId: session.channelId,
      volume: DEFAULT_VOLUME,
      entries: NO_FILTERS,
      rate: 1,
      settings: Promise.resolve(),
      channel: Promise.resolve(),
      unsubscribe: () => undefined,
      closed: false,
    };
    try {
      connection.unsubscribe = session.subscribe(event => this.#onSessionEvent(connection, event));
    } catch (error: unknown) {
      await session.release().catch((cleanup: unknown) => this.#report("voice.session.release", cleanup));
      this.#forgetIfIdle();
      throw toDisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice could not attach to the session", error);
    }
    const voice = new DisTubeVoice(this, connection);
    this.#live = { connection, voice };
    this.guilds.voices.set(this.id, voice);
    return voice;
  }

  #dropJoin(waiters: readonly (AbortSignal | undefined)[]): void {
    if (this.#join?.waiters === waiters) this.#join = undefined;
    this.#forgetIfIdle();
  }

  #end(connection: Connection, reason: VoiceDisconnectReason, error?: DisTubeError): Promise<void> {
    const live = this.#live;
    if (live?.connection !== connection) return this.#close(connection);
    this.#live = undefined;
    this.guilds.voices.delete(this.id);
    const { channelId } = connection;
    const ending: Promise<void> = this.#close(connection).finally(() => {
      this.#left(ending);
      this.config.events.emit("voice.disconnected", {
        guildId: this.id,
        voice: live.voice,
        channelId,
        reason,
        timestamp: Date.now(),
        ...(error ? { error } : {}),
      });
    });
    this.#leaving = ending;
    return ending;
  }

  #left(leaving: Promise<void>): void {
    if (this.#leaving !== leaving) return;
    this.#leaving = undefined;
    this.#forgetIfIdle();
  }

  #close(connection: Connection): Promise<void> {
    if (connection.closing) return connection.closing;
    connection.closed = true;
    connection.unsubscribe();
    const track = this.#track?.connection === connection ? this.#track : undefined;
    track?.controller.abort(STOPPED);
    const player = connection.player;
    connection.closing = (async () => {
      const failures: unknown[] = [];
      await player?.then(
        active => active.release().catch((cleanup: unknown) => failures.push(cleanup)),
        () => undefined,
      );
      await track?.disposed.promise;
      await connection.session.release().catch((cleanup: unknown) => failures.push(cleanup));
      if (failures.length > 0) {
        throw new DisTubeError(ErrorCode.VOICE_FAILED, "DisTubeVoice cleanup failed", {
          cause: failures.length === 1 ? failures[0] : new AggregateError(failures, "DisTubeVoice cleanup failures"),
        });
      }
    })();
    return connection.closing;
  }

  #onSessionEvent(connection: Connection, event: VoiceSessionEvent): void {
    if (connection.closed) return;
    if (event.type === "disconnected") {
      this.#disconnected(connection, event.reason === "failed" ? event.error : undefined);
      return;
    }
    connection.channelId = event.channelId;
    const pending = connection.player;
    this.#serial(connection, async () => {
      const player = await pending?.catch(() => undefined);
      await call("Player failed to refresh the voice gateway", async () => player?.updateVoiceGateway?.(event.gateway));
    }).catch((error: unknown) => this.#report("voice.gateway", error));
  }

  #disconnected(connection: Connection, cause?: Error): void {
    if (this.#live?.connection !== connection) return;
    const error = cause && new DisTubeError(ErrorCode.VOICE_DISCONNECTED, "Voice connection was lost", { cause });
    void this.queue?.delete("voice-loss");
    this.#end(connection, error ? "platform" : "removed", error).catch((failure: unknown) =>
      this.#report("voice.disconnect", failure),
    );
  }

  #startedTrack(): { readonly track: Track; readonly player: Player } {
    const track = this.#track;
    const player = track?.player;
    if (!track || !player || track.connection.closed || track.stop.aborted)
      throw new DisTubeError(ErrorCode.INVALID_STATE, "The queue has no started item");
    return { track, player };
  }

  #ended(track: Track): boolean {
    return this.#track !== track || track.stop.aborted;
  }

  #ensurePlayer(connection: Connection): Promise<Player> {
    if (connection.player) return connection.player;
    const creation: Promise<Player> = this.#serial(connection, async () => {
      const player = await call("Engine failed to create a Player", () =>
        this.config.engine.createPlayer(connection.session, {
          onClosed: () => {
            if (connection.player === creation) connection.player = undefined;
          },
        }),
      );
      try {
        assertOpen(connection);
        await player.setVolume(connection.volume);
        if (connection.entries.length > 0) await player.setFilters(connection.entries);
        return player;
      } catch (error: unknown) {
        await player.release().catch((cleanup: unknown) => this.#report("voice.player.release", cleanup));
        throw toDisTubeError(ErrorCode.VOICE_FAILED, "Player failed to restore voice settings", error);
      }
    });
    connection.player = creation;
    creation.catch(() => {
      if (connection.player === creation) connection.player = undefined;
    });
    return creation;
  }

  #setting(
    connection: Connection,
    message: string,
    apply: (player: Player | undefined) => Promise<void>,
  ): Promise<void> {
    try {
      assertOpen(connection);
    } catch (error: unknown) {
      return Promise.reject(error);
    }
    const pending = connection.player;
    return this.#serial(connection, async () => {
      const player = await pending?.catch(() => undefined);
      await call(message, () => apply(player));
    });
  }

  #serial<Value>(connection: Connection, work: () => Promise<Value>): Promise<Value> {
    const run = connection.settings.then(work);
    connection.settings = run.catch(() => undefined);
    return run;
  }

  #onChannel(connection: Connection, work: () => Promise<void>): Promise<void> {
    const run = connection.channel.then(work);
    connection.channel = run.catch(() => undefined);
    return run;
  }

  #settingsChanged(connection: Connection): void {
    if (this.#live?.connection === connection) this.queue?.voiceSettingsChanged();
  }

  #forgetIfIdle(): void {
    if (!this.queue && !this.#live && !this.#join && !this.#leaving) this.guilds.forget(this);
  }

  #report(stage: string, error: unknown): void {
    this.config.events.report({ severity: "error", stage, message: `Guild ${this.id}: ${stage}`, error });
  }
}

function interruption(track: Track, signal: AbortSignal): TrackEnd | undefined {
  return track.controller.signal.aborted || signal.aborted ? STOPPED : undefined;
}

function playbackRate(engine: Engine, entries: readonly FilterEntry[]): number {
  if (!engine.playbackRate) return 1;
  let rate: unknown;
  try {
    rate = engine.playbackRate(entries);
  } catch (error: unknown) {
    if (DisTubeError.is(error)) throw error;
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, "Engine refused the playback rate of the filters", {
      cause: error,
    });
  }
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0)
    throw new DisTubeError(ErrorCode.INVALID_ARGUMENT, `Engine reported the invalid playback rate ${String(rate)}`);
  return rate;
}

function sameFilters(current: readonly FilterEntry[], next: readonly FilterEntry[]): boolean {
  return (
    current.length === next.length &&
    current.every((entry, index) => entry.name === next[index]?.name && entry.value === next[index]?.value)
  );
}

function seekable(resource: PlaybackResource): boolean {
  if (resource.kind === "encoded") return resource.seekable === true;
  return resource.kind !== "stream";
}

function assertOpen(connection: Connection): void {
  if (connection.closed) throw new DisTubeError(ErrorCode.INVALID_STATE, "DisTubeVoice is no longer connected");
}

async function call<Value>(message: string, operation: () => Promise<Value>): Promise<Value> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw toDisTubeError(ErrorCode.VOICE_FAILED, message, error);
  }
}

function raceSignal<Value>(promise: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (!signal) return promise;
  const aborted = Promise.withResolvers<never>();
  const abort = (): void => aborted.reject(abortError(signal));
  signal.addEventListener("abort", abort, { once: true });
  return Promise.race([promise, aborted.promise]).finally(() => signal.removeEventListener("abort", abort));
}
