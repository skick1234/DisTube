# Quick start

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube<{ requestedBy: string }>({
  adapter: new DiscordJSAdapter(client),
  sources: [new YouTubePlugin(), new SpotifyPlugin(), new SoundCloudPlugin()],
});
const stopLogging = distube.on("queue.item.started", ({ item }) => console.log(item.song.name));
const stopErrors = distube.on("queue.item.failed", ({ item, error }) => console.error(item.song.name, error.code));

const pending = distube.play(voiceChannel, "https://open.spotify.com/track/example", {
  metadata: { requestedBy: "user-id" },
});
const registered = distube.getQueue(voiceChannel.guildId);
const { queue, items } = await pending;
console.log(queue === registered, items[0]?.metadata?.requestedBy);

// When the bot stops:
stopLogging();
stopErrors();
await distube.dispose();
```

`play` registers its queue before returning, then resolves media and joins or reuses voice. A registration event is
not an insertion acknowledgement. The returned promise settles after insertion; playback starts or fails later.
Failed initial work deletes its empty queue only when no other reservation or playback owns it.

A Spotify Song keeps its canonical Spotify URL and identity while core privately searches YouTube, then SoundCloud
for playback. No fallback candidate or signed stream URL enters public state or events.

The runnable example repository handles Discord interaction replies, queue lookup, events and errors using public
packages. Eris bots use `new ErisAdapter(client)` from `@distube/eris` and pass their native voice channel to `play`.
Eris 0.18 requires an Opus implementation for voice; `queue.seek()` rejects with `UNSUPPORTED`.
