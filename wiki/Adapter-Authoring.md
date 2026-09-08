# Adapter authoring

An Adapter owns one platform's voice presence and supplies the default playback engine:
`createVoiceSession(target)` returns the guild's `VoiceSession`, already joined to `target.channelId`, and the
readonly `engine` member is the `Engine` used for every guild unless the client explicitly selects an engine option.

A `VoiceSession` exposes `guildId`, readonly `clientUserId`, the occupied `channelId`, optional `gateway` credentials
(`{ sessionId, token, endpoint }`, carrying no native objects), `join(channelId)` for moves without recreation,
`release()` (overlapping callers share one teardown completion), and `subscribe`. Recoverable connection changes are
private Adapter policy; publish `{ type: "disconnected" }` exactly once when the recovery policy is spent, and
republish `{ type: "connected" }` whenever the credentials change.

An `Engine` implements `createPlayer(session)` and `resolvable(name)` for filter presets. The returned `Player` is
long-lived: it outlives the tracks it plays and the queues that borrow it. It implements readonly `position` (elapsed
seconds), `play({ itemId, resource })`, `pause`, `resume`, `stopTrack` (ends the track, leaving the Player and the
connection usable), `seek`, `setVolume`, `setFilters` (renders the ordered set as one native application; an empty
list clears it), and `subscribe`. Correlate finished/failed outcomes to `itemId`, marking `terminal: true` only when
the Player itself is unusable and must be retired. A capability the backend cannot perform, such as seek, an encoded
resource or a filter, rejects with
`new DisTubeError("UNSUPPORTED", message)`; every
other rejection is reported as `VOICE_FAILED`.

A Player borrows the source resource and must never call its `dispose()`; core owns that cleanup, while the Player
owns every derived native audio resource, listener, timer, and connection. Keep native clients, channels,
connections, and platform events inside the adapter package. Never inspect Song or QueueItem, resolve providers,
mutate queue state, dispose a source resource, or send bot messages.

<!-- verify-ts -->
```ts
import type { PlaybackRequest, Player, PlayerEvent } from "distube/integrations";

declare const nativePlay: (url: string) => Promise<void>;
declare const unsupported: (capability: string) => Error;

const player: Player = {
  position: 0,
  play: (request: PlaybackRequest) =>
    request.resource.kind === "url" ? nativePlay(request.resource.url) : Promise.reject(unsupported("encoded")),
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

Adapter packages import `Adapter`, `Engine`, `Player`, `PlaybackRequest`, `PlayerEvent`, `VoiceSession`, and
`VoiceTarget` as types from public `distube/integrations`, own session/control/stale-outcome tests, and pass packed-install verification
with the packed core contract. Official Adapters expose direct classes only, without create-adapter aliases or
caller-provided factory options.

Official packages provide ready-to-use implementations. Eris bots use the public Eris client and Adapter packages:

<!-- verify-ts -->
```ts
import { ErisAdapter } from "@distube/eris";
import { DisTube } from "distube";

declare const client: ConstructorParameters<typeof ErisAdapter>[0];

const distube = new DisTube({ adapter: new ErisAdapter(client), sources: [] });
```

Eris 0.18 voice playback requires system FFmpeg or `FFMPEG_PATH`, `opusscript` or `@discordjs/opus`, and
`sodium-native` or `tweetnacl` for voice encryption. Eris exposes no supported seek operation, so its Player rejects
`seek` with `UNSUPPORTED` without changing playback state.

An `Engine` declares `accepts`, the readonly set of `PlaybackResource` kinds its Players play. Declare it honestly:
a Player must reject an undeclared kind with `UNSUPPORTED` before native playback starts, and construction validates the explicitly selected engine contract. `resolvable`
carries the same obligation for filter presets: a name you report resolvable must render, and one you report
unresolvable must reject rather than being silently dropped.

## Explicit engines and lifecycle

An engine independent of the platform, such as Lavalink, is passed explicitly as the client engine. If the same
instance also resolves media, pass it in sources too. The Adapter still owns voice sessions and supplies their
gateway credentials to engine Players. Core never discovers an engine by scanning sources.

Engine may supply an optional name and paired initialize(context)/dispose hooks. Supplying only one hook is invalid.
A bare default engine needs no no-op lifecycle methods. SourcePlugin requires its name and lifecycle hooks. Core
initializes sources in configured order followed by the selected explicit or default engine, deduplicates by
instance, and disposes in reverse order. An instance cannot belong to two live clients, including an engine without
hooks.

Queue deletion stops the track and resets both selected filters and backend rendering. The reset joins terminal
cleanup; replacement backend effects wait for that cleanup. Failed rendering preserves the last acknowledged state,
and all owned cleanup is still attempted. Volume, repeat and autoplay survive while the voice remains connected.
Player.release is terminal and precedes VoiceSession.release. Track stop does not release a usable Player.
