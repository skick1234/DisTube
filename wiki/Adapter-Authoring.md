# Adapter authoring

Implement `Adapter.createPlayer({ queueId, guildId, channelId })`. The returned `Player` implements
`play({ itemId, resource })`, `pause`, `resume`, `stop`, `seek`, and `subscribe`. Validate the URL resource, use only
`resource.url` as native audio input, and correlate finished/failed outcomes to `itemId`. A Player borrows the source
resource and must never call its `dispose()` method; core owns that cleanup, while the Player owns every derived native
audio resource, listener, timer, and connection.

Set terminal state synchronously when `stop()` is invoked, suppress late native outcomes, attempt native cleanup once,
share one memoized teardown result with every concurrent stop caller, aggregate distinct cleanup causes, and reject
later playback. An unrecoverable disconnect terminalizes before reporting at most one failure; recoverable connection
changes remain private Adapter policy. Keep native clients, channels, connections, and platform events inside the adapter package.
Never inspect Song or QueueItem, resolve providers, mutate QueueState, dispose a source resource, or send bot messages.

Adapter packages import `Adapter`, `PlaybackRequest`, `Player`, `PlayerEvent`, and `QueueBinding` from public `distube`,
own prepared-resource/connection/control/stale-callback tests, and pass packed-install verification with the packed core
contract. There is no `play(item)` compatibility overload.
Official Adapters expose direct classes only—no create-adapter aliases or caller-provided `playerFactory` option.

<!-- verify-ts -->
```ts
import type { PlaybackRequest, Player, PlayerEvent } from "distube";

declare const nativePlay: (url: string) => Promise<void>;

const player: Player = {
  play: (request: PlaybackRequest) => nativePlay(request.resource.url),
  pause: async () => undefined,
  resume: async () => undefined,
  stop: async () => undefined,
  seek: async () => undefined,
  subscribe: (_listener: (event: PlayerEvent) => void) => () => undefined,
};
```

Official packages provide ready-to-use implementations. Eris bots use the public Eris client and Adapter packages:

<!-- verify-ts -->
```ts
import { ErisAdapter } from "@distube/eris";
import { DisTube } from "distube";

declare const client: ConstructorParameters<typeof ErisAdapter>[0];

const distube = new DisTube({ adapter: new ErisAdapter(client), plugins: [] });
```

Eris 0.18 voice playback requires its optional voice dependencies (`opusscript` or `@discordjs/opus`, plus
`ffmpeg-static` for non-Opus inputs). Eris does not expose a supported seek operation, so its Player rejects `seek`
without changing playback state.
