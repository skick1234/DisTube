---
title: Quick start
description: A complete bot setup that plays, queues, and controls volume and filters.
---

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const youtube = new YouTubePlugin();
const distube = new DisTube<{ requestedBy: string }>({
  adapter: new DiscordJSAdapter(client),
  sources: [youtube, new SpotifyPlugin(), new SoundCloudPlugin()],
});
const stopLogging = distube.on("queue.item.started", ({ item }) => console.log(item.song.name));
const stopErrors = distube.on("queue.item.failed", ({ item, error }) => console.error(item.song.name, error.code));

const queue = await distube.play(voiceChannel, "https://open.spotify.com/track/example", {
  metadata: { requestedBy: "user-id" },
});
console.log(queue.upcoming.length);

await queue.add("lofi hip hop", { next: true });
const voice = queue.voice;
await voice?.setVolume(80);
await voice?.filters.set("bassboost", 15);

const suggestions = await distube.getSuggestions("lo", youtube);
const results = await distube.search("lofi", { source: youtube, limit: 5 });
console.log(suggestions[0], results[0]?.pluginData.views);

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
packages, one command per file. Eris bots use `new ErisAdapter(client)` from `@distube/eris` and pass their native
voice channel to `play`. Eris 0.18 requires an Opus implementation for voice. Local engines seek files and explicitly seekable URLs. Read `queue.voice?.seekable` for the current track;
one-shot streams reject seeking and active filter changes that need a decoder restart.
