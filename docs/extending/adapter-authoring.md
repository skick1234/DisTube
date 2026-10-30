---
title: Adapter authoring
description: Write an Adapter and a playback Engine.
sidebar:
  order: 3
---

This page is for authors who bring DisTube to a new Discord library or a new playback backend. By the end of it you
will have an `Adapter` that joins voice for your platform, and an `Engine` with a `Player` that plays tracks. The
official adapters, `@distube/discordjs` and `@distube/oceanic`, follow the same rules.

## The adapter

An `Adapter<Target>` owns one platform's presence in voice. `Target` is the platform's native voice channel type. The
adapter has three members:

- `normalizeTarget(target)` converts the native `Target` to `{ guildId, channelId }`. It is pure and synchronous. Throw
  to refuse a target, such as one with conflicting guild IDs. The caller then gets `INVALID_ARGUMENT` with your error
  as `cause`.
- `createVoiceSession(target, options)` returns the guild's `VoiceSession`, joined to the channel with
  `options: { selfDeaf, selfMute, timeoutMs, signal? }`. `signal` aborts when `voices.leave` or `dispose` supersedes the
  join. Reject `ABORTED` promptly and release what you created, even when the abort lands in the acknowledgement tick.
- `createEngine(settings)` returns the built-in `Engine`. `settings` is `{ filters?, opusComplexity, bufferMs, report }`
  from `DisTubeOptions` and core. Core calls it unless a plugin carries an engine. An adapter that passes the settings
  object to its engine, as both official adapters do, needs nothing more. See [reporting](#reporting).

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

export const distube = new DisTube<undefined, NativeChannel>({ adapter, plugins: [source] });
```

The second type argument of `DisTube` is your `Target`, so `distube.play` accepts your platform's channels.

## VoiceSession

A `VoiceSession` is one guild's voice connection. It exposes:

- `guildId`, `clientUserId` and the occupied `channelId`.
- `bitrate`, the channel bitrate in bits per second. The built-in engine encodes at the lower of the source bitrate
  and this value.
- `gateway`, the current credentials `{ channelId, sessionId, token, endpoint }`, or `undefined` until the first
  connection settles. They carry no native objects.
- `selfDeaf` and `selfMute`.
- `join(channelId, options?)`, which joins or moves the bot and resolves after the platform acknowledges. An omitted
  flag keeps its current value.
- `setSelfState({ selfDeaf?, selfMute? })`, which writes only the flags, in the channel the session holds when the
  write runs, and resolves after the acknowledgement. It rebuilds nothing and publishes no `connected`. Core routes
  `voice.setSelfDeaf` and `voice.setSelfMute` through it and never through `join`.
- `voiceClosed(code)`, which an engine with its own voice socket calls with the Discord close code. The session
  applies its own policy, and ignores the call once `release` started.
- `rejoin()`, which leaves and rejoins the current channel and resolves after `connected` with fresh credentials.
- `release()`. Overlapping callers share one teardown, and a later `join`, `setSelfState` or `rejoin` rejects.
- `subscribe(listener)`, which returns an unsubscribe function.

`join`, `setSelfState`, `rejoin` and `release` run one at a time, in call order.

### Recovery

Recovery is bounded, so a broken connection cannot rejoin forever:

- Close codes 4006 and 4009 rejoin the current channel, at most 3 times in any 60-second window per guild.
- Codes 4004, 4011, 4016, 4017, 4021 and 4022 end the voice at once, without spending that budget.

Publish `{ type: "disconnected", reason: "failed", error }` once, when that policy is spent. Publish
`{ type: "disconnected", reason: "removed" }` when the platform removes the bot from voice outside a `release`.
Republish `{ type: "connected", channelId, gateway }` whenever the credentials change.

Only the terminal disconnect reaches core. Core deletes the queue with reason `voice-loss` and publishes
`voice.disconnected`, with reason `removed`, or `platform` with a `VOICE_DISCONNECTED` error whose `cause` is yours. A
platform rejection of a voice-state update surfaces as `VOICE_FAILED`, with no native object, token or endpoint in the
cause chain.

Keep native clients, channels, connections and platform events inside the adapter package. An adapter never inspects
Songs, resolves providers, changes queue state or sends bot messages.

## Engine and Player

An `Engine` has `filters`, `createPlayer(session, { onClosed })`, an optional `playbackRate(entries)` and an optional
`prepare(song, { signal })`.

- `filters` is a `ReadonlyMap<string, FilterDefinitionInfo>` describing every preset the engine renders. Entries carry
  `default`, `min`, `max`, `acceptsValue` and `label`, a string that never contains the value. Core validates names and
  clamps values with it, and exposes it as `distube.filters`. Applications can read that before any voice exists, so
  the map must be complete when the engine is created.
- `playbackRate(entries)` returns how many source seconds the ordered selection plays per second of wall time, as this
  engine composes it. Core calls it with the next selection before each filter change reaches the Player, and the
  result becomes `queue.playbackRate`. Implement it when a preset changes speed. Without it every selection plays at
  `1`.
- `prepare` is for engines that replace core's preparation. When present, core calls it for every Song instead of any
  plugin's `stream`. It receives `{ signal }` only, so an engine that wants a source plugin's media searches for it or
  loads it itself.

A `playbackRate` result must be finite and above `0`. A `DisTubeError` it throws rejects the filter change with its
code. Any other throw rejects `INVALID_ARGUMENT` with the throw as `cause`, and so does a result that is not finite and
above `0`. In both cases the Player receives no command.

`createPlayer` runs lazily, on the first track of a voice. The Player lives as long as the voice, and only core's
per-guild owner creates and releases it. A Player implements:

- `position`, the source time in seconds of the audio the platform last played, or `0` without a track. A speed preset
  changes how fast it advances, not what it measures. Applications extrapolate it with `queue.playbackRate`.
- `play(resource, { signal, onStart })`, which plays the resource, replaces any current track and settles with a
  `TrackEnd` when the track ends. A new track starts unpaused, whatever the previous track's pause. Call `onStart` once
  when audio starts. When `signal` aborts, end the track as `stopped`.
- `pause`, `resume`, `seek`, `setVolume(percent)` and `stopTrack`.
- `setFilters(entries)`, which renders the ordered `{ name, value? }` entries as one change. An empty list clears them.
- An optional `updateVoiceGateway(gateway)`.
- `release`, the single teardown. Concurrent, repeated and post-close calls settle from it, and a later `play` or
  control rejects.

When the Player closes on its own, for example on a lost socket, call `onClosed(error)` once. Do it no later than the
tick in which you reject the pending `play`. A queue starts its next item as soon as that rejection settles, so core
must drop the dead Player first. The Player then rejects its pending `play` and every later call except `release`.
Never call `onClosed` for `release`.

A Player cannot dispose the resource it plays. Core does that after the Player stops reading it. The Player owns every
native audio object, listener and timer it creates. An operation the backend cannot perform rejects with
`DisTubeError(ErrorCode.UNSUPPORTED, message)`. Core reports any other rejection as `VOICE_FAILED`.

This sketch shows the shape of an engine that plays only `url` resources and lists three presets. `nativePlay` stands
for your backend, and every other control is a stub. Replace each stub with a call into the backend, including
`setFilters`, which must render the presets. Nightcore changes speed, so `playbackRate` reports it:

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

export const engine: Engine = {
  filters: new Map<string, FilterDefinitionInfo>([
    ["bassboost", { default: 10, min: 0, max: 20, acceptsValue: true, label: "Bass boost" }],
    ["nightcore", { default: 1.25, min: 1, max: 2, acceptsValue: true, label: "Nightcore" }],
    ["earwax", { acceptsValue: false, label: "Earwax" }],
  ]),
  createPlayer: async (_session, _options) => player,
  playbackRate: entries =>
    entries.reduce((rate, entry) => rate * (entry.name === "nightcore" ? (entry.value ?? 1.25) : 1), 1),
};
```

A filter name present in `filters` must render. `setFilters` must not drop an entry silently.

### Presets for the built-in engine

Applications pass presets to the built-in engine through `DisTubeOptions.filters`. Each one is a `FilterDefinition`:
`{ render(value?), default?, min?, max?, label?, tempo? }`. `label` is a string. A definition with none of `default`,
`min` or `max` is fixed and takes no value.

`tempo` is the source seconds per wall second a preset plays at, either a number or a function of the value. It exists
for an engine that cannot read the rate from its payload, as the built-in one cannot.

## Reporting

`settings.report(diagnostic)` delivers a `Diagnostic` to the application's `onDiagnostic`. It returns without calling
the consumer, never throws, and delivers a microtask later, so an engine may call it from its audio path. Without the
delay, a consumer that called `queue.skip()` would re-enter the engine while it pushes packets.

Add `guildId`, `position` in source seconds and a flat `data` record of strings, numbers and booleans.

:::caution
Never put a resource, a playable URL, a header, a path or a token in `data`. Applications log diagnostics.
:::

The built-in engine reports `engine.track.failed`, `engine.input.retried`, `engine.track.starved` and
`engine.worker.load`. The [options reference](../../reference/options/#diagnostics) lists their fields.

## Engine plugins

An engine that does not depend on the platform, such as Lavalink, is a `Plugin` with an `engine` member. Put it in
`plugins`. At most one plugin may carry an engine, and it replaces `adapter.createEngine`.

The adapter still owns the voice session. It hands its gateway credentials to the engine's Players through
`updateVoiceGateway`. Top-level `filters` and the `engine` option section apply to the built-in engine only.

## Ownership

Deleting a queue stops the track and detaches the queue. It does not touch filters, volume, self-deaf or self-mute,
and it does not release the Player. `Player.release` runs when the voice leaves, before `VoiceSession.release`. A later
queue cannot reuse either.

Adapter packages import `Adapter`, `Engine`, `EngineSettings`, `FilterDefinitionInfo`, `Player`, `TrackOptions`,
`PlayerOptions`, `TrackEnd`, `VoiceSession`, `VoiceSessionOptions` and `VoiceTarget` as types from
`distube/integrations`. Official adapters export one class each and take the platform client as their only argument.
