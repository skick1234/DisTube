# Adapter authoring

Implement `Adapter.createPlayer({ queueId, guildId, channelId })`. The returned `Player` implements `play`, `pause`,
`resume`, `stop`, `seek`, and `subscribe`. Keep native clients, channels, connections, and platform events inside the
adapter package. Report only normalized finished/failed item outcomes; never mutate QueueState or send bot messages.

Adapter packages import `Adapter`, `Player`, `PlayerEvent`, `QueueBinding`, and `QueueItem` from public `distube`, own
connection/control/stale-callback tests, and pass packed-install verification with the packed core contract.

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
