# Adapter authoring

An Adapter owns one platform's voice presence and supplies the default playback engine:
`createVoiceSession(target)` returns the guild's `VoiceSession`, already joined to `target.channelId`, and the
readonly `engine` member is the `Engine` used for every guild unless an engine-capable Plugin replaces it.

A `VoiceSession` exposes `guildId`, the occupied `channelId`, optional `gateway` credentials
(`{ sessionId, token, endpoint }`, carrying no native objects), `join(channelId)` for moves without recreation,
`release()` (overlapping callers share one teardown completion), and `subscribe`. Recoverable connection changes are
private Adapter policy; publish `{ type: "disconnected" }` exactly once when the recovery policy is spent, and
republish `{ type: "connected" }` whenever the credentials change.

An `Engine` implements `createPlayer(session)` and `resolvable(name)` for filter presets. The returned `Player` is
long-lived: it outlives the tracks it plays and the queues that borrow it. It implements readonly `position` (elapsed
seconds), `play({ itemId, resource })`, `pause`, `resume`, `stopTrack` (ends the track, leaving the Player and the
connection usable), `seek`, `setVolume`, `setFilters` (renders the ordered set as one native application; an empty
list clears it), and `subscribe`. Correlate finished/failed outcomes to `itemId`, marking `terminal: true` only when
the Player itself is unusable and must be retired. A capability the backend does not perform — seek or an `encoded`
resource on a voice engine, a filter it cannot render — rejects with `DisTubeError(ErrorCode.UNSUPPORTED)`; every
other rejection is reported as `VOICE_FAILED`.

A Player borrows the source resource and must never call its `dispose()`; core owns that cleanup, while the Player
owns every derived native audio resource, listener, timer, and connection. Keep native clients, channels,
connections, and platform events inside the adapter package. Never inspect Song or QueueItem, resolve providers,
mutate queue state, dispose a source resource, or send bot messages.

<!-- verify-ts -->
```ts
import type { PlaybackRequest, Player, PlayerEvent } from "distube";

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
};
```

Adapter packages import `Adapter`, `Engine`, `Player`, `PlaybackRequest`, `PlayerEvent`, `VoiceSession`, and
`VoiceTarget` from public `distube`, own session/control/stale-outcome tests, and pass packed-install verification
with the packed core contract. Official Adapters expose direct classes only — no create-adapter aliases or
caller-provided factory options.

Official packages provide ready-to-use implementations. Eris bots use the public Eris client and Adapter packages:

<!-- verify-ts -->
```ts
import { ErisAdapter } from "@distube/eris";
import { DisTube } from "distube";

declare const client: ConstructorParameters<typeof ErisAdapter>[0];

const distube = new DisTube({ adapter: new ErisAdapter(client), plugins: [] });
```

Eris 0.18 voice playback requires its optional voice dependencies (`opusscript` or `@discordjs/opus`, plus
`ffmpeg-static` for non-Opus inputs). Eris exposes no supported seek operation, so its Player rejects `seek` with
`UNSUPPORTED` without changing playback state.

## Engine-capable Plugins

An engine that is not tied to one platform — a Lavalink-style node, for example — ships as a Plugin that also
satisfies the `Engine` members. Configuring one replaces the Adapter's default engine for every guild; the Adapter
still owns the voice sessions and hands each session's `gateway` credentials to the engine's Players.
