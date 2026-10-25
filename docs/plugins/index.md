---
title: Plugins
description: Official DisTube plugins for YouTube, SoundCloud, Spotify and Lavalink.
---

Pass source plugins in one ordered `plugins` array. The first plugin that resolves a URL owns the Song.
A plugin with an `engine`, such as Lavalink, replaces the adapter's built-in engine without changing source order.

| Plugin                    | Package               | Provides                                                  |
| ------------------------- | --------------------- | --------------------------------------------------------- |
| [YouTube](youtube/)       | `@distube/youtube`    | Videos, playlists, search, related videos and suggestions |
| [SoundCloud](soundcloud/) | `@distube/soundcloud` | Tracks, sets, search, related tracks and suggestions      |
| [Spotify](spotify/)       | `@distube/spotify`    | Tracks and collections, played through another source     |
| [Lavalink](lavalink/)     | `@distube/lavalink`   | Source lookup and remote playback over a node pool        |

## Install

Install the sources you need alongside `distube` and your adapter:

```sh title="npm"
npm install @distube/youtube @distube/ytdl-core @distube/soundcloud @distube/spotify
```

```sh title="Bun"
bun add @distube/youtube @distube/ytdl-core @distube/soundcloud @distube/spotify
```

## Example

```ts
import { SoundCloudPlugin } from "@distube/soundcloud";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import { DisTube } from "distube";
import type { Adapter } from "distube/integrations";

declare const adapter: Adapter;

const distube = new DisTube({
  adapter,
  plugins: [new YouTubePlugin(), new SpotifyPlugin(), new SoundCloudPlugin()],
});
```

Spotify supplies metadata only. Core plays its Songs through the first other plugin with `search` and `stream` whose
top result prepares, so list one such as YouTube.
At most one plugin may carry an engine. See the [quick start](../guides/quick-start/),
[plugin authoring](../guides/plugin-authoring/) and [error handling](../guides/error-handling/) guides.
