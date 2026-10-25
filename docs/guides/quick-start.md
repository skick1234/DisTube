---
title: Quick start
description: A complete bot setup that plays, queues, and controls volume and filters.
sidebar:
  order: 2
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
  plugins: [youtube, new SpotifyPlugin(), new SoundCloudPlugin()],
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

const suggestions = await distube.suggest("lo", { source: youtube });
const results = await distube.search("lofi", { source: youtube, limit: 5 });
console.log(suggestions[0], results[0]?.pluginData.views);

stopLogging();
stopErrors();
await distube.dispose();
```

On Oceanic, use `new OceanicAdapter(client)` from `@distube/oceanic` with an Oceanic `Client` and channel; the rest is
the same. [Installation](../installation/) shows both setups.

`play` registers the guild queue before it returns, then resolves the media, joins or reuses the voice and inserts
the result. The returned promise settles after the insertion. Playback starts or fails later and reports through
`queue.item.started` and `queue.item.failed`. A failed first insertion deletes its empty queue with
`queue.deleted` reason `failed`.

A Spotify Song keeps its Spotify URL as identity. Spotify cannot stream, so core searches the other plugins in order for
the track name and artists and plays the first result.

The example bot in the `example` repository shows Discord replies, queue lookup, events and error
handling, one command per file.
