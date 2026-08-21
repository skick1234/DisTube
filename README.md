# DisTube v6

DisTube manages queues and playback, adapters connect platforms and supply the playback engine, plugins add media
providers, and examples teach usage.

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
Eris voice playback needs an Opus implementation and FFmpeg for non-Opus inputs; its Player rejects seek with
`UNSUPPORTED`. An Adapter owns platform connections and supplies the playback engine that creates Players; core sees
only guild and channel IDs.

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

## 5. Play

```ts
const { queue, items } = await distube.play(
  { guildId: "guild-id", voiceChannelId: "voice-channel-id" },
  "https://youtube.com/watch?v=example",
);
console.log(`Committed ${items.length} insertion(s)`);
```

`play` is the only creation-capable entry point: it upserts the guild's queue, joins or reuses the guild's Voice, and
inserts the resolved media. It resolves after QueueItems plus `Events.QueueItemAdded` commit—not after audio starts.
Later insertions can also use `queue.enqueue(input)`; look the queue up anytime with `distube.getQueue(guildId)`.

## 6. Control the Queue

```ts
import { Filters, RepeatMode } from "distube";

await queue.skip();
await queue.jump(2); // one-based over waiting items
await queue.setVolume(80);
await queue.setRepeatMode(RepeatMode.Queue);
await queue.setAutoplay(true);
await queue.filters.apply(Filters.Nightcore);
await queue.stop(); // deletes the queue; the guild's Voice stays connected
await distube.voices.leave("guild-id"); // releases the Voice (and any live queue)
```

Read `queue.state` for readonly waiting items, optional current item, and status. A queue deletes itself when playback
exhausts (`Events.QueueFinished` then `Events.QueueDeleted`); the Voice remains until asked to leave.

## 7. Events

```ts
import { Events } from "distube";

distube.on(Events.QueueItemStarted, ({ guildId, item, timestamp }) => {
  console.log(guildId, item.song.title, timestamp);
});
```

The client emits ten string-valued `Events` members: `QueueCreated`, `QueueItemAdded`, `QueuePlaylistAdded`,
`QueueItemStarted`, `QueueItemFinished`, `QueueItemFailed`, `QueueFinished`, `QueueAutoplayFailed`, `QueueDeleted`,
and `VoiceDisconnected`. Events describe committed queue actions; bot code owns messages. Explicit Spotify-style
fallback retains the original QueueItem in state and events and exposes no candidate or stream URL.

## 8. Advanced Extensions

Implement `Adapter` (voice sessions plus an `Engine`) to connect another platform or playback backend. Implement
`SourcePlugin` to add a media provider. SourcePlugins implement cancellable search/resolve plus `preparePlayback` and
optional `related` for autoplay; Players accept only `{ itemId, resource }`. Extensions import public `distube`
contracts, keep `Song.url` canonical, own package-local tests and provider/platform cleanup policy, and verify packed
public entry points. See the authoring guides and breaking migration guide in `wiki/`.
