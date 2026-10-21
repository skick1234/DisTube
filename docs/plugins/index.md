---
title: Plugins
description: Official DisTube source plugins for YouTube, SoundCloud, Spotify and Lavalink.
---

A `SourcePlugin` resolves URLs, searches a provider and streams media. Pass plugins to `sources` in the order they
should be consulted. The first plugin whose `resolve` returns a value owns the input.

| Plugin                    | Package               | Provides                                                             |
| ------------------------- | --------------------- | -------------------------------------------------------------------- |
| [YouTube](youtube/)       | `@distube/youtube`    | Videos, playlists, search, related videos, suggestions               |
| [SoundCloud](soundcloud/) | `@distube/soundcloud` | Tracks, sets, search, related tracks, suggestions                    |
| [Spotify](spotify/)       | `@distube/spotify`    | Tracks, albums, playlists and artists, played through another source |
| [Lavalink](lavalink/)     | `@distube/lavalink`   | A source and a remote playback engine over a Lavalink node pool      |

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  sources: [new YouTubePlugin(), new SpotifyPlugin(), new SoundCloudPlugin()],
});
```

Spotify returns a search query, so another source in the list must be able to play the result. To write your own
plugin, read [SourcePlugin authoring](../guides/plugin-authoring/). Failures from every plugin carry a
`DisTubeError` code you narrow with `DisTubeError.is`, as described in [error handling](../guides/error-handling/).
