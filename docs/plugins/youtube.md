---
title: YouTube
description: Play YouTube videos and playlists with @distube/youtube and @distube/ytdl-core.
---

`@distube/youtube` resolves videos and playlists, searches, supplies related videos and suggests search completions.

## Install

Install alongside `distube` and your adapter:

```sh title="npm"
npm install @distube/youtube @distube/ytdl-core
```

```sh title="Bun"
bun add @distube/youtube @distube/ytdl-core
```

## Example

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
await distube.play(voiceChannel, "never gonna give you up");
```

## Options and playback

`YouTubePluginOptions` has one optional field:

- `ytdl`: a `Ytdl` instance from `@distube/ytdl-core`, defaulting to `new Ytdl()`.

Its cookie, token provider, `fetch`, client order and language apply to every operation.
The plugin never disposes the instance or its token provider; their creator owns cleanup.

Playback prefers audio-only Opus, then other audio-only formats, then audio from a video format. The first
preparation of a Song resolved from a video URL reuses its lookup if it expires more than a minute later;
later preparations look up fresh media. Signed URLs and credentials stay inside ytdl-core, never on the Song
or playback resource. Non-live WebM and MP4 formats use seekable `reader` resources when a URL and positive
content length are available, or `timed` resources when no URL is available. All other cases use `stream` resources.
For remote playback, [Lavalink](../lavalink/) loads the Song's page URL and never asks this plugin for a resource.

Songs expose `live`, `views` and `uploader` through typed `pluginData`. Search clamps `limit` to 20 and uses a
zero-based `offset`. Provider failures are core `DisTubeError` instances with codes such as `NOT_FOUND`,
`UNAVAILABLE` and `RATE_LIMITED`, `error.source` set to `"youtube"` and the ytdl-core failure as `cause`.

See the [quick start](../guides/quick-start/), [clips and playback resources](../guides/direct-inputs/) and
[error handling](../guides/error-handling/) guides.
