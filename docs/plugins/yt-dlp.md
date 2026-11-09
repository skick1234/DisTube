---
title: yt-dlp
description: Play links from sites yt-dlp supports with @distube/yt-dlp.
sidebar:
  order: 5
---

`@distube/yt-dlp` plays links from any site [yt-dlp](https://github.com/yt-dlp/yt-dlp) supports, such as Bandcamp or
Twitch. Use it to cover the sites your other plugins do not. It only plays links: it has no search, related tracks or
suggestions.

## Install

```sh title="npm"
npm install @distube/yt-dlp
```

```sh title="Bun"
bun add @distube/yt-dlp
```

You do not need Python or a separate yt-dlp install, because the plugin downloads yt-dlp on first use. The
[installation guide](../../get-started/installation/) covers `distube` and your adapter.

## Set it up

List it after your other plugins, so YouTube, SoundCloud and Spotify keep their own links:

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

The plugin passes on links to plain files and to pages yt-dlp has no extractor for, so the next plugin can try them.
To play direct audio links, see [direct links](../../popular-topics/direct-links/). A playlist stops at the
`maxPlaylistSongs` option of `DisTube`.

## The yt-dlp binary

By default, the plugin's first use downloads yt-dlp from GitHub into the package's `bin/` folder, and yt-dlp updates
itself once per process start after that.

`new YtDlpPlugin({ binary })` uses a yt-dlp you installed instead, version 2025.11.12 or later. The plugin runs it as
is and never downloads or updates it. Set it when:

- the install is read-only, such as a Docker image;
- your platform has no standalone yt-dlp release, where the plugin rejects `UNSUPPORTED`. Releases exist for Linux,
  macOS and Windows on x64 and arm64.

```ts
import { YtDlpPlugin } from "@distube/yt-dlp";

export const ytdlp = new YtDlpPlugin({ binary: "/usr/local/bin/yt-dlp" });
```

yt-dlp reads its usual config files, so set cookies (`--cookies`), a proxy and other flags there.

## Limits

- Media a site offers only as DASH rejects `UNSUPPORTED`.
- Sites whose media needs cookies or special headers to download fail to play, even when yt-dlp can read the page.
- Seeking works only when the site's server allows it. Live streams cannot seek.

## Errors

A failure reaches your bot as a `DisTubeError` with `error.source` set to `"yt-dlp"`. Its message is yt-dlp's last
`ERROR:` line.

| Code             | What happened                                                        |
| ---------------- | -------------------------------------------------------------------- |
| `NOT_FOUND`      | The page or media does not exist                                     |
| `UNAVAILABLE`    | The media is private, members-only, region-blocked or behind a login |
| `AGE_RESTRICTED` | The site keeps an age gate that yt-dlp cannot pass without cookies   |
| `RATE_LIMITED`   | The site is throttling your bot                                      |
| `UNSUPPORTED`    | No playable format, or no yt-dlp release for your platform           |
| `SOURCE_FAILED`  | Anything else, including a failed download of yt-dlp itself          |

The [error reference](../../reference/errors/) lists every code.
