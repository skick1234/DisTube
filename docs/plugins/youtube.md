---
title: YouTube
description: Play YouTube videos and playlists, and search YouTube Music, with @distube/youtube and @distube/ytdl-core.
sidebar:
  order: 2
---

`@distube/youtube` resolves videos, playlists and channel uploads, searches, supplies related videos and suggests
search completions. Its second plugin, `YouTubeMusicPlugin`, does the same for YouTube Music songs.

## Install

Install alongside `distube` and your adapter. `@distube/ytdl-core` is a peer dependency, version `^5.2.0`. The [installation guide](../../get-started/installation/) covers the rest of the setup:

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

`YouTubePluginOptions` has two optional fields:

- `ytdl`: a `Ytdl` instance from `@distube/ytdl-core`, defaulting to `new Ytdl()`.
- `preferPlaylist`: when `true`, a watch URL that also names a playlist (`watch?v=...&list=PL...`) resolves to the playlist. It defaults to `false`, which plays the video. `WL`, `LL` and mix lists always play the video.

The `ytdl` instance's cookie, token provider, `fetch`, client order and language apply to every operation.
The plugin never disposes the instance or its token provider; their creator owns cleanup.
A playlist stops at the `maxPlaylistSongs` option of `DisTube`, and the plugin requests no page past it.

Playback prefers audio-only Opus, then other audio-only formats, then audio from a video format. The first
preparation of a Song resolved from a video URL reuses its lookup if it expires more than a minute later;
later preparations look up fresh media. Signed URLs and credentials stay inside ytdl-core, never on the Song
or playback resource. Non-live WebM and MP4 formats use seekable `reader` resources when a URL and positive
content length are available, or `timed` resources when no URL is available. All other cases use `stream` resources.
For remote playback, [Lavalink](../lavalink/) loads the Song's page URL and never asks this plugin for a resource.

A channel URL resolves to the channel's uploads Playlist, cut at `maxPlaylistSongs`. The plugin accepts `/@handle`,
`/channel/UC...`, `/c/name` and `/user/name` on `youtube.com`, `www.youtube.com`, `m.youtube.com` and
`music.youtube.com`. A video or playlist link takes precedence over a channel path.

Songs expose `live`, `views` and `uploader` through typed `pluginData`. `song.ageRestricted` is known only for a
video looked up in full, by `resolve` or autoplay. Search results and playlist entries leave it absent; `play` without
`allowAgeRestricted: true` looks a single unknown Song up first. Search clamps `limit` to 20 and uses a
zero-based `offset`. Provider failures are core `DisTubeError` instances with codes such as `NOT_FOUND`,
`UNAVAILABLE` and `RATE_LIMITED`, `error.source` set to `"youtube"` and the ytdl-core failure as `cause`. A video
lookup or stream failure carries `error.media` `"song"`, a playlist lookup failure `"playlist"`.

YouTube's bot check is `UNAVAILABLE` with `cause.code === "BOT_CHECK"`. The sections below explain how to sign in with a cookie. The
ytdl-core [PO token guide](https://distube.js.org/ytdl-core/guides/po-tokens/) covers PO token providers.
See [errors](../../reference/errors/#bot-check).

## YouTube Music

`YouTubeMusicPlugin`, named `youtube-music`, searches YouTube Music's songs, suggests YouTube Music's completions and
continues autoplay from YouTube Music's radio. Its Songs play exactly like `YouTubePlugin`'s. Give both plugins one
`Ytdl` and choose the catalog per call with `source`:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubeMusicPlugin, YouTubePlugin } from "@distube/youtube";
import { Ytdl } from "@distube/ytdl-core";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

const ytdl = new Ytdl();
const music = new YouTubeMusicPlugin({ ytdl });
const youtube = new YouTubePlugin({ ytdl });
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [music, youtube] });

const songs = await distube.search("kevin macleod", { source: music });
const videos = await distube.search("kevin macleod", { source: youtube });
const completions = await distube.suggest("kevin macl", { source: music });
```

`YouTubeMusicPlugin` resolves `music.youtube.com` watch and playlist links. A watch link becomes one `youtube-music`
Song and its `list` parameter is ignored. A playlist link to a curated `RDCLAK5uy_` list, an `OLAK5uy_` album or a
user playlist becomes a `youtube-music` Playlist cut at `maxPlaylistSongs`. Generated mixes, channel and browse pages
and every other YouTube URL go to `YouTubePlugin`. DisTube asks plugins in order, so list `YouTubeMusicPlugin` first
to own Music links; listed after `YouTubePlugin`, or left out, those links become `youtube` Songs. Without `source`,
`distube.search` also asks the plugins in order, so listing `YouTubeMusicPlugin` first makes music search the default.

Autoplay follows the plugin that made the last Song. After a `youtube-music` Song it stays on the YouTube Music radio
of the last Song the user picked: each autoplay Song records that radio as `pluginData.radioSeed`, and a Song from
search or a link starts a new radio. A video played through either plugin counts as played for both.

Songs link to `https://music.youtube.com/watch?v=<id>` and carry the same `pluginData` as YouTube Songs: `uploader`
and `artist` hold the artists and `views` the play count. Search clamps `limit` to 20. Failures map to the same codes
with `error.source` set to `"youtube-music"`. Search, suggestions and radio skip the cookie, so they show the
signed-out catalog; links and playback use the `Ytdl` exactly as `YouTubePlugin` does.

## Sign in with a cookie

### When you need a cookie

Two failures call for one. `AGE_RESTRICTED` means the video needs a signed-in, age-verified account. `BOT_CHECK` means YouTube answered "Sign in to confirm you're not a bot", which is common on datacenter and VPS IP addresses.

If YouTube refuses the cookie you pass, the signed-in attempts in `error.attempts` fail with `AUTH_FAILED`. The error's own code is `AUTH_FAILED` unless another client gave a more specific answer, so an age-restricted video still fails with `AGE_RESTRICTED`. See [Confirming it works](#confirming-it-works) and [When it stops working](#when-it-stops-working).

### Account risk

Signed-in automated access can get a YouTube account suspended. Use a throwaway account that you have age-verified, never your main one.

### Copy the cookie from Chrome or Edge

1. Open a private window and sign in to [youtube.com](https://www.youtube.com) with the throwaway account.
2. Open DevTools with F12 and select the Network panel.
3. Type `youtubei` in the filter box.
4. Play any video so requests appear in the list.
5. Select one of the requests and open its Headers tab.
6. Under Request Headers, find `cookie` and copy its whole value.
7. Close the private window without signing out. Signing out invalidates the cookie.

### Copy the cookie from Firefox

1. Open a private window and sign in to [youtube.com](https://www.youtube.com) with the throwaway account.
2. Open the Web Developer Tools with F12 and select the Network panel.
3. Type `youtubei` in the filter box.
4. Play any video so requests appear in the list.
5. Select one of the requests and open its Headers tab.
6. Under Request Headers, turn on the Raw toggle so the headers show as plain text.
7. Find the `Cookie` line and copy its whole value, without the `Cookie:` prefix.
8. Close the private window without signing out. Signing out invalidates the cookie.

### Export a cookies.txt file instead

A Netscape `cookies.txt` export works too. Make one with a browser extension such as [Get cookies.txt LOCALLY](https://github.com/kairi003/Get-cookies.txt-LOCALLY), or with `yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download <video URL>`, run against a browser profile signed in to the throwaway account. Pass the file's text as the cookie. `Ytdl` keeps only the `youtube.com` cookies from the export and ignores the rest.

### Store the cookie

The value contains `;` and `=`, so put it in double quotes in a `.env` file:

```dotenv
YT_COOKIE="SAPISID=AbCdEf/GhIjKl; LOGIN_INFO=AFmmF2sw...; __Secure-3PAPISID=AbCdEf/GhIjKl; ..."
```

On a hosting panel, paste the value into an environment variable field.

Or keep a cookies.txt export in a file outside your repository and read it at startup:

```ts
import { Ytdl } from "@distube/ytdl-core";
import { readFileSync } from "node:fs";

const ytdl = new Ytdl({ cookie: readFileSync("youtube-cookies.txt", "utf8") });
```

Never commit the cookie. Anyone who has it can act as that account.

### Confirming it works

`new Ytdl({ cookie })` throws a `YtdlError` with code `INVALID_ARGUMENT` when the value has no `SAPISID` or `__Secure-3PAPISID` cookie. That is a signed-out copy, so copy it again while signed in.

For the real test, look up an age-restricted video. If it returns formats, the cookie works. If the lookup fails, `error.attempts` lists every client that was tried, and the signed-in ones show `signedIn: true`:

```ts
import { Ytdl, YtdlError } from "@distube/ytdl-core";

declare const ytdl: Ytdl;
declare const ageRestrictedUrl: string;

try {
  await ytdl.getInfo(ageRestrictedUrl);
  console.log("The cookie works");
} catch (error) {
  if (!YtdlError.is(error)) throw error;
  console.log(error.code);
  for (const attempt of error.attempts.filter(attempt => attempt.signedIn)) {
    console.log(attempt.client, attempt.step, attempt.code, attempt.reason);
  }
}
```

Read more about the error in the [error guide](https://distube.js.org/ytdl-core/guides/errors/).

### When it stops working

Signing out of the browser session that made the cookie invalidates it, so keep that session signed in or close its window without signing out. YouTube can also expire a cookie on its own. When the signed-in entries of `error.attempts` show `AUTH_FAILED`, YouTube is treating your cookie as signed out, even if `error.code` is `AGE_RESTRICTED` or `BOT_CHECK`. Copy a fresh one and restart the process that uses it.

### Use the cookie with the plugin

Build the `Ytdl` instance with the cookie and pass it to the plugin:

```ts
import { YouTubePlugin } from "@distube/youtube";
import { Ytdl } from "@distube/ytdl-core";

const youtube = new YouTubePlugin({ ytdl: new Ytdl({ cookie: process.env.YT_COOKIE }) });
```

The plugin sends every search, lookup and stream request through that instance.

### How a failure reaches your bot

A song that fails to prepare arrives in the `queue.item.failed` event as `error`. `BOT_CHECK` arrives as a `DisTubeError` with code `UNAVAILABLE`, and `AGE_RESTRICTED` with code `AGE_RESTRICTED`, the code DisTube also uses when a call does not allow age-restricted media. `AUTH_FAILED` is not translated by the plugin, so DisTube wraps it as `SOURCE_FAILED`. Both keep the original `YtdlError` as `error.cause`. A refused cookie can also arrive as `AGE_RESTRICTED`, and only its signed-in attempts show `AUTH_FAILED`. A video link fails earlier, and `distube.play` rejects with the same codes and cause (see the [play command](../../recipes/play-command/)). Searches and playlist entries fail later, in `queue.item.failed`:

```ts
import { YtdlError } from "@distube/ytdl-core";
import type { DisTube } from "distube";

declare const distube: DisTube<unknown>;

distube.on("queue.item.failed", ({ item, error }) => {
  const cause: unknown = error.cause;
  if (YtdlError.is(cause) && cause.attempts.some(attempt => attempt.signedIn && attempt.code === "AUTH_FAILED")) {
    console.error(`YouTube refused the cookie while preparing ${item.song.name}. Copy a fresh one.`);
  } else if (YtdlError.is(cause, "BOT_CHECK") || YtdlError.is(cause, "AGE_RESTRICTED")) {
    console.error(`YouTube wants a signed-in account for ${item.song.name}: ${cause.code}`);
  }
});
```

See the [error reference](../../reference/errors/) for every code and the [events reference](../../reference/events/) for `queue.item.failed`.

To play a clip or an audio URL instead, see the [soundboard](../../recipes/soundboard/) for clips and [direct links](../../recipes/direct-links/) for audio URLs.
Start with the [quick start](../../get-started/quick-start/) if you have no bot yet.
