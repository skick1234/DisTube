---
title: Adapter authoring
description: Write an Adapter and a playback Engine.
sidebar:
  order: 3
---

An `Adapter<Target>` owns one platform's voice gateway presence. It has three members:

- `normalizeTarget(target)` converts the platform's native `Target` to `{ guildId, channelId }`. It is pure and
  synchronous. Throw to refuse a target, such as one with conflicting guild IDs. The caller gets
  `INVALID_ARGUMENT` with your error as `cause`.
- `createVoiceSession(target, options)` returns the guild's `VoiceSession`, joined to the channel with
  `options: { selfDeaf, selfMute, timeoutMs, signal? }`. When `signal` aborts because `voices.leave` or `dispose`
  superseded the join, reject `ABORTED` promptly and release what you created, including when the abort lands in
  the acknowledgement tick.
- `createEngine(settings)` returns the built-in `Engine`. `settings` is `{ filters?, opusComplexity, bufferMs }`
  from `DisTubeOptions`. Core calls it unless a plugin carries an engine.

```ts
import { DisTube } from "distube";
import type { Adapter, Engine, Plugin, VoiceSession, VoiceSessionOptions, VoiceTarget } from "distube/integrations";

interface NativeChannel {
  readonly guildSnowflake: string;
  readonly voiceSnowflake: string;
}

declare const createGatewaySession: (target: VoiceTarget, options: VoiceSessionOptions) => Promise<VoiceSession>;
declare const localEngine: Engine;
declare const source: Plugin;

const adapter: Adapter<NativeChannel> = {
  normalizeTarget: channel => ({ guildId: channel.guildSnowflake, channelId: channel.voiceSnowflake }),
  createVoiceSession: createGatewaySession,
  createEngine: () => localEngine,
};
const distube = new DisTube<undefined, NativeChannel>({ adapter, plugins: [source] });
```

## VoiceSession

A `VoiceSession` exposes:

- `guildId`, `clientUserId` and the occupied `channelId`.
- `bitrate`, the channel bitrate in bits per second. The built-in engine encodes at the lower of the source
  bitrate and this value.
- `gateway`, the current credentials `{ channelId, sessionId, token, endpoint }`, or `undefined` until the first
  connection settles. They carry no native objects.
- `selfDeaf` and `selfMute`.
- `join(channelId, options?)`, which joins or moves the bot and resolves after the platform acknowledges. An omitted
  flag keeps its current value.
- `setSelfState({ selfDeaf?, selfMute? })`, which writes only the flags, in the channel the session holds when the
  write runs, and resolves after the acknowledgement. It rebuilds nothing and publishes no `connected`. Core routes
  `voice.setSelfDeaf` and `voice.setSelfMute` through it and never through `join`.
- `voiceClosed(code)`, which an engine with its own voice socket calls with the Discord close code. The session
  applies its own policy and ignores the call once `release` started.
- `rejoin()`, which leaves and rejoins the current channel and resolves after `connected` with fresh credentials.
- `release()`. Overlapping callers share one teardown, and a later `join`, `setSelfState` or `rejoin` rejects.
- `subscribe(listener)`, which returns an unsubscribe function.

`join`, `setSelfState`, `rejoin` and `release` run one at a time in call order.

Recovery is bounded. Close codes 4006 and 4009 rejoin the current channel, at most 3 times in any 60 s window per
guild. Codes 4004, 4011, 4016, 4017, 4021 and 4022 end the voice at once without spending the budget. Publish `{ type:
"disconnected", reason: "failed", error }` once, when that policy is spent, and `{ type: "disconnected", reason:
"removed" }` when the platform removes the bot from voice outside a `release`. Republish `{ type: "connected",
channelId, gateway }` whenever the credentials change. Only the terminal disconnect reaches core. It deletes the queue
with reason `voice-loss` and publishes `voice.disconnected` with reason `removed`, or `platform` with a
`VOICE_DISCONNECTED` error whose `cause` is yours. A platform rejection of a voice-state update surfaces as
`VOICE_FAILED` with no native object, token or endpoint in the cause chain.

Keep native clients, channels, connections and platform events inside the adapter package. Never inspect Songs,
resolve providers, change queue state or send bot messages.

## Engine and Player

An `Engine` has `filters`, `createPlayer(session, { onClosed })` and an optional `prepare(song, { signal })`.

- `filters` is a `ReadonlyMap<string, FilterDefinitionInfo>` describing every preset the engine renders. Entries
  carry `default`, `min`, `max`, `acceptsValue` and `label(value?)`. Core validates names and clamps values with
  it, and exposes it as `voice.filters.definitions`.
- `prepare` is for engines that replace core's preparation. When present, core calls it for every Song instead of
  any plugin's `stream`. It receives `{ signal }` only, so an engine that wants a source plugin's media searches
  or loads it itself.

`createPlayer` runs lazily on the first track of a voice. The Player lives as long as the voice, and only
core's per-guild owner creates and releases it. A Player implements:

- `position`, the elapsed seconds of the active track, or `0`.
- `play(resource, { signal, onStart })`, which plays the resource, replaces any current track and settles with a
  `TrackEnd` when the track ends. A new track starts unpaused whatever the previous track's pause. Call `onStart` once when audio starts. When `signal` aborts, end the track as
  `stopped`.
- `pause`, `resume`, `seek`, `setVolume(percent)`, `stopTrack` and `release`.
- `setFilters(entries)`, which renders the ordered `{ name, value? }` entries as one change. An empty list clears
  them.
- Optional `updateVoiceGateway(gateway)`.
- `release`, the single teardown. Concurrent, repeated and post-close calls settle from it, and a later `play` or
  control rejects.

When the Player closes itself, for example on a lost socket, call `onClosed(error)` once, no later than the tick in
which you reject the pending `play`. A queue starts its next item as soon as that rejection settles, so core
must drop the dead Player first. The Player rejects its pending `play` and every later call except `release`. Never
call `onClosed` for `release`.
A Player cannot dispose the resource it plays. Core does that after the Player stops reading it. The
Player owns every native audio object, listener and timer it creates. An operation the backend cannot perform
rejects with `DisTubeError(ErrorCode.UNSUPPORTED, message)`. Core reports any other rejection as `VOICE_FAILED`.

```ts
import { DisTubeError, ErrorCode } from "distube";
import type {
  Engine,
  FilterDefinitionInfo,
  PlaybackResource,
  Player,
  TrackEnd,
  TrackOptions,
} from "distube/integrations";

declare const nativePlay: (url: string, signal: AbortSignal, onStart: () => void) => Promise<TrackEnd>;

const player: Player = {
  position: 0,
  play: (resource: PlaybackResource, options: TrackOptions) =>
    resource.kind === "url"
      ? nativePlay(resource.url, options.signal, options.onStart)
      : Promise.reject(new DisTubeError(ErrorCode.UNSUPPORTED, "Resource kind unsupported")),
  pause: async () => undefined,
  resume: async () => undefined,
  stopTrack: async () => undefined,
  seek: async (_seconds: number) => undefined,
  setVolume: async (_percent: number) => undefined,
  setFilters: async () => undefined,
  release: async () => undefined,
};

const engine: Engine = {
  filters: new Map<string, FilterDefinitionInfo>([
    ["bassboost", { default: 10, min: 0, max: 20, acceptsValue: true, label: value => `Bass +${value ?? 10}dB` }],
    ["earwax", { acceptsValue: false, label: () => "earwax" }],
  ]),
  createPlayer: async (_session, _options) => player,
};
void engine;
```

A filter name present in `filters` must render. `setFilters` must not drop an entry silently. The preset shape that
feeds the built-in engine through `DisTubeOptions.filters` is `FilterDefinition`: `{ render(value?), default?,
min?, max?, label? }`. A definition with none of `default`, `min` or `max` is fixed and takes no value.

## Engine plugins

An engine independent of the platform, such as Lavalink, is a `Plugin` with an `engine` member. Put it in
`plugins`. At most one plugin may carry an engine, and it replaces `adapter.createEngine`. The adapter still owns
the voice session and hands its gateway credentials to the engine's Players through `updateVoiceGateway`. Top-level
`filters` and the `engine` option section apply to the built-in engine only.

## Ownership

Queue deletion stops the track and detaches the queue. It does not touch filters, volume, self-deaf or
self-mute, and it does not release the Player. `Player.release` runs when the voice leaves, before
`VoiceSession.release`. A later queue cannot reuse either.

Adapter packages import `Adapter`, `Engine`, `EngineSettings`, `FilterDefinitionInfo`, `Player`, `TrackOptions`,
`PlayerOptions`, `TrackEnd`, `VoiceSession`, `VoiceSessionOptions` and `VoiceTarget` as types from `distube/integrations`. Official
adapters export one class each and take the platform client as their only argument.
