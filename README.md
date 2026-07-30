# DisTube v6

DisTube manages queues and playback, adapters connect platforms, plugins add capabilities, and examples teach usage.

## 1. Install

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

## 2. Create DisTube

<!-- verify-ts -->
```ts
import { type Adapter, DisTube, type Plugin } from "distube";

declare const adapter: Adapter;
declare const plugins: readonly Plugin[];

const distube = new DisTube({ adapter, plugins });
```

Construction validates the adapter and initializes plugin instances synchronously. Call `await distube.shutdown()`
when the bot stops.

## 3. Configure an Adapter

```ts
import { DiscordJSAdapter } from "@distube/discordjs";

const adapter = new DiscordJSAdapter(client);
```

Use `OceanicAdapter` from `@distube/oceanic` for oceanic.js or `ErisAdapter` from `@distube/eris` for Eris 0.18.
Eris voice playback needs an Opus implementation and FFmpeg for non-Opus inputs; its Player rejects unsupported seek.
Adapters own platform connections and Player behavior; core sees only queue, guild, and channel IDs.

## 4. Add Plugins

```ts
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";

const youtube = new YouTubePlugin();
const spotify = new SpotifyPlugin();
const soundcloud = new SoundCloudPlugin();
const plugins = [youtube, spotify, soundcloud];
```

Official media plugins live in the independent plugins repository. Retain an instance to call typed provider search:

```ts
const results = await youtube.search("DisTube tutorial");
```

## 5. Create a Queue

```ts
const queue = distube.createQueue({ guildId: "guild-id", channelId: "voice-channel-id" });
```

The binding is explicit and stable. A second active queue cannot claim the same guild/channel pair.

## 6. Enqueue Media

```ts
const items = await queue.enqueue("https://youtube.com/watch?v=example");
await queue.enqueue(results[0], { requestedBy: "user-id" });
console.log(`Committed ${items.length} insertion(s)`);
```

`enqueue` is the only insertion method and resolves after QueueItems plus `queue.item.added` commit—not after audio
starts. Queue controls are `remove`, `skip`, `pause`, `resume`, `stop`, and `seek`. Stop clears logical state and fences
late work before awaiting terminal Player and source-resource cleanup.

## 7. Events

```ts
distube.on("queue.item.started", ({ queueId, item, timestamp }) => {
  console.log(queueId, item.song.title, timestamp);
});
```

The client emits `queue.created`, `queue.item.added`, `queue.item.started`, `queue.item.finished`,
`queue.item.failed`, and `queue.destroyed`. Events describe committed queue actions; bot code owns messages. Explicit
Spotify-style fallback retains the original QueueItem in state and events and exposes no candidate or stream URL.

## 8. Advanced Extensions

Implement `Adapter` and `Player` from `distube` to connect another platform. Implement `SourcePlugin` to add a media
provider. SourcePlugins implement cancellable search/resolve plus `preparePlayback`; Players accept only
`{ itemId, resource }`. Extensions import public `distube` contracts, keep `Song.url` canonical, own package-local tests
and provider/platform cleanup policy, and verify packed public entry points. See the authoring guides and breaking
migration guide in `wiki/`.
