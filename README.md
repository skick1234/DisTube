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

Official media plugins live in the independent plugins repository. Plugin order is search order, so put the provider
you want queries answered by first. Retain an instance when you need a candidate list of your own to show the user
before committing to one; `limit` and `offset` are bounded and each plugin documents its own default and maximum:

```ts
const results = await youtube.search("DisTube tutorial", { limit: 5 });
```

## 5. Play

```ts
const { queue, items } = await distube.play(
  { guildId: "guild-id", voiceChannelId: "voice-channel-id" },
  "https://youtube.com/watch?v=example",
);
console.log(`Committed ${items.length} insertion(s)`);

// A query works the same way: no separate search step.
await distube.play({ guildId: "guild-id", voiceChannelId: "voice-channel-id" }, "never gonna give you up");
```

A string that parses as an absolute `http:` or `https:` URL is resolved by the first plugin that claims it; every
other non-empty string is a query, searched across your plugins in the order you configured them. The first plugin to
return a candidate wins, and a plugin whose search throws is skipped rather than failing the call. The same rule
substitutes a playable stream when a metadata-only source (Spotify, say) hands back a search query instead of a
resource, so a Spotify link plays through whichever streaming plugin you listed first.

`play` is the only creation-capable entry point. It upserts the guild's queue, joins or reuses the guild's Voice, and
inserts the resolved media. It resolves after the QueueItems and matching insertion event commit, not after audio
starts. A Song publishes `Events.QueueItemAdded`; a Playlist publishes `Events.QueuePlaylistAdded`. Later insertions
can also use `queue.enqueue(input)`. Look the queue up anytime with `distube.getQueue(guildId)`.

## 6. Control the Queue

```ts
import { Filters, RepeatMode } from "distube";

await queue.skip();
await queue.jump(1); // zero-based over waiting items, so this is the second one waiting
await queue.stop(); // deletes the queue; the guild's Voice stays connected

// Volume, repeat, autoplay, filters, and history live on the Voice, not the queue.
const voice = distube.voices.get("guild-id")!;
await voice.setVolume(80);
await voice.setRepeatMode(RepeatMode.Queue);
await voice.setAutoplay(true);
await voice.filters.apply(Filters.Nightcore);
await distube.voices.leave("guild-id"); // releases the Voice (and any live queue)
```

Read `queue.state` for readonly waiting items, optional current item, and status. A queue deletes itself when playback
exhausts (`Events.QueueFinished` then `Events.QueueDeleted`); the Voice remains until asked to leave, and the next
`play()` inherits its volume, repeat mode, autoplay, filters, and `voice.previousSongs` unchanged.

## 7. Events

```ts
import { Events } from "distube";

distube.on(Events.QueueItemStarted, ({ guildId, item, timestamp }) => {
  console.log(guildId, item.song.title, timestamp);
});
```

The client emits ten string-valued `Events` members: `QueueCreated`, `QueueItemAdded`, `QueuePlaylistAdded`,
`QueueItemStarted`, `QueueItemFinished`, `QueueItemFailed`, `QueueFinished`, `QueueAutoplayFailed`, `QueueDeleted`,
and `VoiceDisconnected`. `on`, `once`, `off`, and `removeAllListeners(name?)` all return the client; `off` takes the
function you passed, so it removes a `once` registration too. Name your caller metadata once and every read is typed:
`new DisTube<{ requestedBy: string }>({ adapter, plugins })` makes `event.item.metadata.requestedBy` compile. Events describe committed queue actions; bot code owns messages. Explicit Spotify-style
fallback retains the original QueueItem in state and events and exposes no candidate or stream URL.

## 8. Advanced Extensions

Implement `Adapter` (voice sessions plus an `Engine`) to connect another platform or playback backend. Implement
`SourcePlugin` to add a media provider. SourcePlugins implement cancellable search/resolve plus `preparePlayback` and
optional `related` for autoplay; Players accept only `{ itemId, resource }`. Extensions import public `distube`
contracts, keep `Song.url` canonical, own package-local tests and provider/platform cleanup policy, and verify packed
public entry points. See the authoring guides and breaking migration guide in `wiki/`.
