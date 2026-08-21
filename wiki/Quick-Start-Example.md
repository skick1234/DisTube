# Quick start

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import { DisTube, Events } from "distube";

const youtube = new YouTubePlugin();
const spotify = new SpotifyPlugin();
const soundcloud = new SoundCloudPlugin();
const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  // Configured order is URL-routing order and explicit fallback preference.
  plugins: [youtube, spotify, soundcloud],
});
distube.on(Events.QueueItemStarted, ({ item }) => console.log(item.song.title));
distube.on(Events.QueueItemFailed, ({ item, error }) => console.error(item.song.title, error.code));

const { queue, items } = await distube.play(
  { guildId, voiceChannelId },
  "https://open.spotify.com/track/example",
);
console.log(`Insertion committed: ${items[0]?.id}`);
```

`play()` upserts the guild's queue, joins or reuses the guild's Voice, and resolves after insertion and
`Events.QueueItemAdded`, before playback preparation may finish. Observe `Events.QueueItemStarted` or
`Events.QueueItemFailed` for the later outcome. A Spotify Song keeps its canonical Spotify URL and identity while core
privately searches YouTube, then SoundCloud; no fallback candidate or stream URL enters events.

The runnable example repository shows Discord interaction replies, guild queue lookup, all events, all error codes,
and shutdown using packed public packages.

For Eris, replace the Adapter construction with `new ErisAdapter(client)` from `@distube/eris`; queue and event code
stays platform-neutral. Eris 0.18 requires an Opus implementation for voice, and `queue.seek()` rejects with
`UNSUPPORTED`.
