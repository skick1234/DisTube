---
title: Plugins
description: Official DisTube plugins for YouTube, SoundCloud, Spotify, yt-dlp and Lavalink.
sidebar:
  order: 1
---

DisTube finds and plays nothing by itself. Plugins do that work. Each one knows one provider. It turns that
provider's links and search queries into Songs and prepares their audio. Pick the plugins for the sites your members
use and list them in the `plugins` array when you create `DisTube`.

| Plugin                    | Package               | What it gives your bot                                    |
| ------------------------- | --------------------- | --------------------------------------------------------- |
| [YouTube](youtube/)       | `@distube/youtube`    | Videos, playlists, search, related videos and suggestions |
| [SoundCloud](soundcloud/) | `@distube/soundcloud` | Tracks, sets, search, related tracks and suggestions      |
| [Spotify](spotify/)       | `@distube/spotify`    | Tracks and collections, played through another source     |
| [yt-dlp](yt-dlp/)         | `@distube/yt-dlp`     | Links from any site a yt-dlp extractor supports           |
| [Lavalink](lavalink/)     | `@distube/lavalink`   | Source lookup and remote playback over a node pool        |

## Install

Install each plugin you use next to `distube` and your adapter. The [installation guide](../get-started/installation/)
installs YouTube with the rest, and each plugin page has its own install command.

## Add plugins to your bot

This setup plays YouTube, Spotify and SoundCloud:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin(), new SpotifyPlugin(), new SoundCloudPlugin()],
});

await distube.play(voiceChannel, "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT");
```

## Why the order matters

DisTube asks the plugins in the order you list them:

- A link goes to each plugin that resolves links, and the first one that recognises it owns the Song.
- A search query goes to each plugin that searches, and the first one with a result wins.

So the first plugin that can search is your default search. Put a catch-all plugin such as [yt-dlp](yt-dlp/) last, so
the dedicated plugins see their own links first.

Spotify only supplies track names and artists. DisTube plays its Songs by searching the other plugins, so list at least
one plugin that can play, such as YouTube. Without one, `new DisTube` throws `INVALID_ARGUMENT`.

## Playback engines

A plugin can also carry an engine that plays the audio somewhere else. Listing [Lavalink](lavalink/) replaces
the adapter's built-in engine, and the other plugins keep their order for links and searches. At most one
plugin may carry an engine.

Ready to write your own? See [plugin authoring](../extending/plugin-authoring/). Every code a plugin can fail with is
in the [error reference](../reference/errors/).
