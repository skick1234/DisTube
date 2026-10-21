---
title: Adapter authoring
description: Write an Adapter and a playback Engine.
---

An `Adapter<Target>` owns one platform's gateway voice presence. It converts the platform's native `Target` with
pure synchronous `normalizeTarget(target)` and returns `{ guildId, channelId }`. Core validates and copies those
IDs before registering a queue or joining voice. Throw from `normalizeTarget` to refuse a target, such as one with
conflicting guild IDs; the caller gets `INVALID_ARGUMENT` with your error as `cause`. `createVoiceSession(normalizedTarget, options?)` returns the
guild's `VoiceSession`, joined to the target channel with the requested `JoinOptions` (`{ selfDeaf?, selfMute? }`).
Core defaults to self-deaf true and self-mute false. `engine` is an optional default; a client without one must
select an explicit engine. The selected engine owns audio transport and its prerequisites.

```ts
import { DisTube } from "distube";
import type { Adapter, Engine, JoinOptions, SourcePlugin, VoiceSession, VoiceTarget } from "distube/integrations";

interface NativeChannel {
  readonly guildSnowflake: string;
  readonly voiceSnowflake: string;
}

declare const createGatewaySession: (target: VoiceTarget, options?: JoinOptions) => Promise<VoiceSession>;
declare const remoteEngine: Engine;
declare const source: SourcePlugin;

const adapter: Adapter<NativeChannel> = {
  normalizeTarget: channel => ({ guildId: channel.guildSnowflake, channelId: channel.voiceSnowflake }),
  createVoiceSession: createGatewaySession,
};
const distube = new DisTube<unknown, NativeChannel>({ adapter, sources: [source], engine: remoteEngine });
declare const channel: NativeChannel;
const queue = await distube.play(channel, "a song query");
await queue.voice?.setVolume(60);
```

This sample uses no local engine. The source handles the query; the adapter handles only gateway membership.

A `VoiceSession` exposes `guildId`, readonly `clientUserId`, the occupied `channelId`, optional `gateway` credentials
(`{ channelId, sessionId, token, endpoint }`, carrying no native objects), readonly `selfDeaf` and `selfMute`,
`join(channelId, options?)` for moves and voice-state changes without recreation, `setSelfDeaf(enabled)` and
`setSelfMute(enabled)` that resolve after the gateway acknowledges, `release()` (overlapping callers share one
teardown completion), and `subscribe`. Recoverable connection changes are private Adapter policy; publish
`{ type: "disconnected" }` exactly once when the recovery policy is spent, and republish `{ type: "connected" }`
whenever the credentials change. A platform rejection of a voice-state update surfaces as `VOICE_FAILED` with no
native object, token or endpoint in the public cause chain. Stage request-to-speak is not part of the contract.

An `Engine` declares `accepts`, `capabilities`, `filters` and `createPlayer(session)`. It may also provide
`supportsResource(resource)` for options its Player cannot use. The returned `Player` is long-lived: it outlives
the tracks it plays, and `DisTubeVoice` alone creates and releases it, once per connection.
Queues never borrow it. It implements readonly `position` (elapsed seconds), `play({ itemId, resource })`, `pause`,
`resume`, `stopTrack` (ends the track, leaving the Player and the connection usable), `seek`, `setVolume`,
`setFilters` (renders the ordered `{ name, value? }` entries as one native application; an empty list clears it),
and `subscribe`. The request's `itemId` is an opaque private per-play correlation ID, not a QueueItem ID. Echo it
unchanged in finished/failed outcomes; never parse it or derive public identity from it. `DisTubeVoice` maps it back
to the caller-supplied public `itemId`, so queue events retain their original QueueItem ID. Mark `terminal: true`
only when the Player itself is unusable and must be retired. A capability the backend cannot perform, such as an
encoded resource or a filter, rejects with `new DisTubeError("UNSUPPORTED", message)`; every other rejection is reported as `VOICE_FAILED`.

A Player borrows the source resource and must never call its `dispose()`; core owns that cleanup, while the Player
owns every derived native audio resource, listener, timer, and connection. Keep native clients, channels,
connections, and platform events inside the adapter package. Never inspect Song or QueueItem, resolve providers,
mutate queue state, dispose a source resource, or send bot messages.

| Stage                | Owner action                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| Construction         | Adapter and engine validate local options; optional hooks perform no provider or gateway request |
| Target normalization | Adapter returns plain guild and channel IDs synchronously                                        |
| Voice join           | Adapter creates one gateway session with the requested voice state                               |
| First track          | Selected engine creates one Player for that voice; the Player borrows each submitted resource    |
| Track end            | Player ends native playback; core releases the accepted resource after backend access ends       |
| Voice leave          | Voice releases Player, then Adapter session; a later queue cannot reuse either                   |

| Adapter or engine outcome                                                                          | Public result                                                             |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Malformed target IDs or constructor configuration                                                  | `INVALID_ARGUMENT`                                                        |
| Resource kind, encoded format, resource options, seek or filter unsupported by the selected engine | `UNSUPPORTED` before native work where core can decide it                 |
| Gateway state update or Player effect fails                                                        | `VOICE_FAILED` with safe causal detail                                    |
| Optional engine lifecycle hook fails                                                               | `PLUGIN_FAILED`; core still attempts entered disposers                    |
| Accepted resource cleanup fails                                                                    | The accepting boundary reports cleanup causes after ending backend access |

```ts
import { DisTubeError, ErrorCode } from "distube";
import type { PlaybackRequest, Player, PlayerEvent } from "distube/integrations";

declare const nativePlay: (url: string) => Promise<void>;

const player: Player = {
  position: 0,
  play: (request: PlaybackRequest) =>
    request.resource.kind === "url"
      ? nativePlay(request.resource.url)
      : Promise.reject(new DisTubeError(ErrorCode.UNSUPPORTED, "Resource kind unsupported")),
  pause: async () => undefined,
  resume: async () => undefined,
  stopTrack: async () => undefined,
  seek: async (_seconds: number) => undefined,
  setVolume: async (_percent: number) => undefined,
  setFilters: async () => undefined,
  subscribe: (_listener: (event: PlayerEvent) => void) => () => undefined,
  release: async () => undefined,
};
```

## Capabilities and filter definitions

`accepts` is the readonly set of `PlaybackResource` kinds the Players play. Declare it honestly: a Player must
reject an undeclared kind with `UNSUPPORTED` before native playback starts, and construction validates the
selected engine. If `accepts` includes `encoded`, provide non-empty `encodedFormats`. Core checks
`resource.format` against it before Player work. An engine for Lavalink v4 uses `"lavalink.v4"`; the string is
part of the resource contract, not an opaque value that another engine may guess.

For option-level limits, add the optional `supportsResource(resource): boolean` method. Core checks kind and
encoded format first, then calls this method synchronously before creating a Player. Return `false` for a valid
resource the engine cannot play, such as a URL with headers on a remote backend that cannot forward them. Keep the
method pure: it decides compatibility without starting playback or changing engine state. Core retains the method
bound to the selected engine at construction, so replacing the property later does not change the client. A
minimal engine that supports every declared kind and format needs no method. During explicit source fallback, core
cleans up a rejected candidate and tries the next one within the documented bounds. Player activation failures
end that attempt.

`accepts`, `encodedFormats` and `filters` use structural readonly set and map contracts. They can come from a
custom collection with the required methods; core snapshots them at construction, so later external mutation
does not change the selected engine. The `Map` and `Set` below are ordinary examples, not required classes.

`capabilities` is `{ seek: boolean }`. Core rejects `queue.seek` and `voice.seek` with `UNSUPPORTED` before calling
the Player when it is false. Official local engines support file seeking and URLs explicitly marked
`seekable: true`. Streams cannot seek; their decoder cannot restart after an active filter change. A URL seek
reopens the request and decodes/discards audio to the offset, so large seeks cost time and bandwidth. The active
track's `voice.seekable` combines the engine and resource limits.

`filters` is a `ReadonlyMap<string, FilterDefinitionInfo>` describing every preset the engine renders. Each entry
carries `default`, `min`, `max`, `acceptsValue` and `label(value?)`. Core reads it to validate a preset name, clamp
a value to its range and reject a value on a fixed preset, and exposes the same map as `voice.filters.definitions`
so bots can build command choices. A name present in the map must render; `setFilters` must not silently drop an
entry. The construction-time `FilterDefinition` shape that feeds the map is `{ render(value?), default?, min?,
max?, label? }`; a definition with none of `default`, `min` or `max` is fixed.

```ts
import type { Engine, FilterDefinitionInfo, PlaybackResource, Player, VoiceSession } from "distube/integrations";

declare const createPlayer: (session: VoiceSession) => Promise<Player>;

const engine: Engine = {
  accepts: new Set<PlaybackResource["kind"]>(["url"]),
  capabilities: { seek: false },
  filters: new Map<string, FilterDefinitionInfo>([
    ["bassboost", { default: 10, min: 0, max: 20, acceptsValue: true, label: value => `Bass +${value ?? 10}dB` }],
    ["earwax", { acceptsValue: false, label: () => "earwax" }],
  ]),
  supportsResource: resource => resource.kind === "url" && resource.headers === undefined,
  createPlayer,
};
```

Adapter packages import `Adapter`, `Engine`, `FilterDefinitionInfo`, `JoinOptions`, `Player`, `PlaybackRequest`,
`PlayerEvent`, `VoiceSession`, and `VoiceTarget` as types from public `distube/integrations`, own
session/control/stale-outcome tests, and pass packed-install verification with the packed core contract. Official
Adapters expose direct classes only, without create-adapter aliases or caller-provided factory options.

Official packages provide ready-to-use implementations. Eris bots use the public Eris client and Adapter packages:

```ts
import { ErisAdapter } from "@distube/eris";
import { DisTube } from "distube";

declare const client: ConstructorParameters<typeof ErisAdapter>[0];

const distube = new DisTube({ adapter: new ErisAdapter(client), sources: [] });
```

Eris 0.18 voice playback requires system FFmpeg or `FFMPEG_PATH`, `opusscript` or `@discordjs/opus`, and
`sodium-native` or `tweetnacl` for voice encryption. Self-deaf and self-mute are join options and runtime setters on
every official adapter, not `ErisAdapter` constructor options.

## Explicit engines and lifecycle

An engine independent of the platform, such as Lavalink, is passed explicitly as the client engine. If the same
instance also resolves media, pass it in sources too. The Adapter still owns voice sessions and supplies their
gateway credentials to engine Players. Core never discovers an engine by scanning sources.

Engine may supply an optional `name`, synchronous `initialize(context)` and asynchronous or synchronous `dispose()`.
The hooks are independently optional. A bare default engine needs no no-op lifecycle methods. Core enters sources
in configured order followed by the selected explicit or default engine, deduplicates by instance, and disposes
entered identities in reverse order. If initialization fails, core also disposes the failing identity before
releasing its reservation. An instance cannot belong to two live clients, including an engine without hooks.

Queue deletion stops the track and detaches the queue; it does not touch filters, volume, self-deaf or self-mute,
and it does not release a still-connected Player. `Player.release` is terminal and precedes `VoiceSession.release`
when the voice leaves. Track stop does not release a usable Player.
