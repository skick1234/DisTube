---
title: yt-dlp
description: Play URLs from sites yt-dlp supports with @distube/yt-dlp.
sidebar:
  order: 5
---

`@distube/yt-dlp` plays links from any site a [yt-dlp](https://github.com/yt-dlp/yt-dlp) site extractor supports, such
as Bandcamp or Twitch. Use it to cover the sites the other plugins do not. It only plays links. It has no search,
related tracks or suggestions.

## Install

```sh title="npm"
npm install @distube/yt-dlp
```

```sh title="Bun"
bun add @distube/yt-dlp
```

You do not need Python or a separate yt-dlp install. The plugin downloads yt-dlp on first use, as
[the binary](#the-yt-dlp-binary) explains. The [installation guide](../../get-started/installation/) covers `distube`
and your adapter.

## Set it up

List it after the dedicated plugins, so YouTube, SoundCloud and Spotify handle their own links first:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { YtDlpPlugin } from "@distube/yt-dlp";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin(), new YtDlpPlugin()],
});

await distube.play(voiceChannel, "https://example.bandcamp.com/track/example");
```

## Links it plays

Only `http` and `https` links resolve. The plugin turns yt-dlp's generic extractor off. It declines a page that no site
extractor supports, and a direct file link, without a request, so the next plugin gets it. To play direct audio links,
see [direct links](../../popular-topics/direct-links/).

A playlist stops at `maxPlaylistSongs`. A collection of collections, such as a YouTube channel's tabs, plays their
entries in order. A playlist with no playable entries fails `NO_RESULT`.

## The yt-dlp binary

`new YtDlpPlugin()` takes one optional field, `binary`. It is the path to a yt-dlp executable, version 2025.11.12 or
later, which the plugin runs as is and never downloads or updates.

Without `binary`, the first operation downloads the platform's standalone yt-dlp release from GitHub into the
package's `bin/` directory. It checks the file's SHA-256 against the release's `SHA2-256SUMS`. On later process starts,
yt-dlp runs its own `--update` once before the first operation.

Standalone releases exist for Linux (glibc and musl, x64 and arm64), macOS and Windows (x64, x86 and arm64). Any other
platform rejects `UNSUPPORTED`, so set `binary` there.

:::tip
A read-only install, such as a Docker image, cannot download into `bin/`. Install yt-dlp in the image and set
`binary` to its path.
:::

yt-dlp reads its normal config files, so put cookies (`--cookies`), a proxy and similar settings there. The plugin
passes the running Node or Bun binary to yt-dlp as a JavaScript runtime, so YouTube extraction works without Deno.

## Songs and playlists

Songs expose `extractor` and `live` through typed `pluginData`, plus `views` and `likes` when the site reports them.
`song.ageRestricted` is `true` when the site's `age_limit` is 18 or more, and unset on entries of a flat playlist.
Playlists expose `extractor`.

## How playback works

When a Song is about to play, the plugin asks yt-dlp for the best audio format that is not DASH. It hands that format's
URL to the engine as a `url` resource, as v5 did. Audio-only formats come first, Opus before the rest, because the
engine can play Opus without re-encoding it. Otherwise the plugin takes the video format with the best audio at the
lowest resolution.

HLS formats, including most live streams, play on the built-in engine. Plain-HTTP formats can seek when their server
serves byte ranges. HLS formats cannot.

:::caution
Media offered only as DASH rejects `UNSUPPORTED`. Sites whose media URLs need cookies or headers fail to play, because
the engine fetches the URL without them.
:::

With [Lavalink](../lavalink/), the node loads the Song's page URL itself and the plugin skips this step.

## Errors

A failure reaches your bot as a `DisTubeError` with `error.source` set to `"yt-dlp"`. Its message is yt-dlp's last
`ERROR:` line, with every URL cut down to its origin.

| Code             | What happened                                                          |
| ---------------- | ---------------------------------------------------------------------- |
| `NOT_FOUND`      | The page or media does not exist                                       |
| `UNAVAILABLE`    | The media is private, members-only, region-blocked or behind a login   |
| `AGE_RESTRICTED` | The site keeps an age gate that yt-dlp cannot pass without cookies     |
| `RATE_LIMITED`   | The site is throttling your bot                                        |
| `UNSUPPORTED`    | No playable format, such as DASH-only media, or no release for your OS |
| `SOURCE_FAILED`  | Anything else, including a failed download of yt-dlp itself            |

The [error reference](../../reference/errors/) lists every code. New to DisTube? Start with the
[quick start](../../get-started/quick-start/).
