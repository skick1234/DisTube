---
title: YouTube
description: Play YouTube videos, playlists and channel uploads, and search YouTube Music, with @distube/youtube.
sidebar:
  order: 2
---

`@distube/youtube` lets your bot play YouTube. Members can paste a video, playlist or channel link or type a search,
and autoplay keeps going with related videos when the queue runs out. The plugin also suggests completions while a
member types. The same package has a second plugin, `YouTubeMusicPlugin`, which does the same for YouTube Music.

## Install

```sh title="npm"
npm install @distube/youtube
```

```sh title="Bun"
bun add @distube/youtube
```

The plugin depends on `@distube/ytdl-core` `^5.2.0` and installs it for you. Install it yourself only when you want to
import `Ytdl`, for example to [sign in with a cookie](#sign-in-with-a-cookie). The
[installation guide](../../get-started/installation/) covers `distube` and your adapter.

## Set it up

Put the plugin in the `plugins` array:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});

await distube.play(voiceChannel, "never gonna give you up");
```

A query that is not a link searches YouTube and plays the top result.

## Links it plays

- A video link plays the video.
- A playlist link plays the playlist.
- A channel link plays the channel's uploads. The plugin accepts `/@handle`, `/channel/UC...`, `/c/name` and
  `/user/name` on `youtube.com`, `www.youtube.com`, `m.youtube.com` and `music.youtube.com`.

When a link names both a video or playlist and a channel path, the video or playlist wins. A playlist or channel stops
at the `maxPlaylistSongs` option of `DisTube`, and the plugin requests no page past it. A playlist with no playable
entries fails `NO_RESULT`.

A live video has no length, so its `duration` is `0` and `formattedDuration` reads `Live`.

## Options

`new YouTubePlugin()` takes two optional fields.

`preferPlaylist` decides what a watch link that also names a playlist plays, such as `watch?v=...&list=PL...`. By
default it is `false` and the link plays the video. Set it to `true` to play the playlist instead. Watch later (`WL`),
liked videos (`LL`) and mixes always play the video.

`ytdl` is a `Ytdl` instance from `@distube/ytdl-core`, `new Ytdl()` by default. Every request the plugin makes goes
through it, so its cookie, PO token provider, `fetch`, client order and language apply everywhere. The plugin never
disposes the instance or its token provider. Whoever creates them cleans them up.

## YouTube Music

`YouTubeMusicPlugin`, named `youtube-music`, searches YouTube Music's songs, suggests YouTube Music's completions and
continues autoplay from YouTube Music's radio. Its Songs play exactly like the ones `YouTubePlugin` finds. Give both
plugins one `Ytdl`, then pick the catalog per call with `source`:

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
console.log(songs.length, videos.length, completions);
```

`YouTubeMusicPlugin` only resolves `music.youtube.com` watch and playlist links:

- A watch link becomes one `youtube-music` Song. The plugin ignores its `list` parameter.
- A playlist link to a curated `RDCLAK5uy_` list, an `OLAK5uy_` album or a user playlist becomes a `youtube-music`
  Playlist, cut at `maxPlaylistSongs`.

Generated mixes, channel and browse pages and every other YouTube link go to `YouTubePlugin`, so keep both in the
array. List `YouTubeMusicPlugin` first so it owns Music links. Listed after `YouTubePlugin`, or left out, those links
become `youtube` Songs. A search without `source` also asks the plugins in order, so listing `YouTubeMusicPlugin`
first makes music search your default.

Music Songs link to `https://music.youtube.com/watch?v=<id>`. They carry the same `pluginData` as YouTube Songs:
`uploader` and `artist` hold the artists, and `views` holds the play count. Search returns at most 20 results.
Failures use the same codes as YouTube's, with `error.source` set to `"youtube-music"`.

Search, suggestions and radio skip the cookie, so they show the signed-out catalog. Links and playback use the `Ytdl`
exactly as `YouTubePlugin` does.

## Autoplay

With autoplay on, the plugin looks up to three related videos in full, in YouTube's order. It leaves out videos the
queue played recently, and the first one that answers plays. When a candidate fails `NOT_FOUND`, `UNAVAILABLE`,
`NOT_STARTED` or `AGE_RESTRICTED`, the plugin moves on to the next, because the problem belongs to that one video. Any other failure, such as `BOT_CHECK` or
`RATE_LIMITED`, ends the attempt at once, because it concerns your bot's client and the next video would fail too. When
all three fail, `queue.autoplay.failed` carries the last failure's code.

After a `youtube-music` Song, autoplay stays on the YouTube Music radio of the last Song a member picked. Each autoplay
Song records that radio as `pluginData.radioSeed`, and a Song from a search or a link starts a new radio. A video
played through either plugin counts as played for both.

## Songs and search results

Songs expose `live`, `views` and `uploader` through typed `pluginData`.

`song.ageRestricted` is known only for a video looked up in full, by a link or by autoplay. Search results and
playlist entries leave it unset. That is why `distube.play` without `allowAgeRestricted: true` looks up a single Song
with an unknown age restriction before it adds it.

Search returns at most 20 results per call, and `offset` counts from zero.

## How playback works

You do not need this section to use the plugin, but it explains what you see when a Song starts.

The plugin prefers audio-only Opus, then other audio-only formats, then the audio of a video format. A Song that was
looked up in full already holds a lookup: a video link, an autoplay Song, or a search result that `distube.play`
checked for an age restriction. Its first preparation reuses that lookup if it is valid for more than another minute.
Every other preparation looks the video up fresh. Signed URLs and credentials stay inside ytdl-core.
They never appear on the Song or the playback resource.

Non-live WebM and MP4 formats can seek. They play as a `reader` resource when they have a URL and a known size, and as
a `timed` resource when they have no URL. Everything else plays as a `stream` resource, which cannot seek. With
[Lavalink](../lavalink/), the node loads the Song's page URL itself and never asks this plugin for audio.

## Errors

A YouTube failure reaches your bot as a `DisTubeError` with `error.source` set to `"youtube"` and the ytdl-core error
as `error.cause`. A failed video lookup or stream sets `error.media` to `"song"`, and a failed playlist lookup sets it
to `"playlist"`.

| Code             | What happened                                                                     |
| ---------------- | --------------------------------------------------------------------------------- |
| `NOT_FOUND`      | The video or playlist does not exist                                              |
| `UNAVAILABLE`    | The video is private, members-only, Premium-only, region-blocked or has no format |
| `AGE_RESTRICTED` | YouTube wants a signed-in, age-verified account                                   |
| `NOT_STARTED`    | A premiere or scheduled live stream has not started                               |
| `BOT_CHECK`      | YouTube answered "Sign in to confirm you're not a bot"                            |
| `RATE_LIMITED`   | YouTube is throttling your bot                                                    |

`AGE_RESTRICTED` and `BOT_CHECK` usually mean you should sign in with a cookie, which the next section walks you
through. A PO token provider can also get past a bot check. The ytdl-core
[PO token guide](https://distube.js.org/ytdl-core/guides/po-tokens/) shows how. The
[error reference](../../reference/errors/#bot-check) has more on bot checks.

## Sign in with a cookie

### When you need a cookie

Two failures call for one. `AGE_RESTRICTED` means the video needs a signed-in, age-verified account. `BOT_CHECK` means
YouTube answered "Sign in to confirm you're not a bot", which is common on datacenter and VPS IP addresses.

If YouTube refuses the cookie you pass, the signed-in attempts in `error.attempts` fail with `AUTH_FAILED`. The
error's own code is `AUTH_FAILED` unless another client gave a more specific answer, so an age-restricted video still
fails with `AGE_RESTRICTED`. [Confirm it works](#confirm-it-works) and [when it stops working](#when-it-stops-working)
show how to tell.

### Account risk

:::danger
Signed-in automated access can get a YouTube account suspended. Use a throwaway account that you have age-verified,
never your main one.
:::

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

A Netscape `cookies.txt` export works too. Make one with a browser extension such as
[Get cookies.txt LOCALLY](https://github.com/kairi003/Get-cookies.txt-LOCALLY), or run
`yt-dlp --cookies-from-browser firefox --cookies cookies.txt --skip-download <video URL>` against a browser profile
signed in to the throwaway account. Pass the file's text as the cookie. `Ytdl` keeps only the `youtube.com` cookies
from the export and ignores the rest.

### Store the cookie

The value contains `;` and `=`, so put it in double quotes in a `.env` file:

```dotenv title=".env"
YT_COOKIE="SAPISID=AbCdEf/GhIjKl; LOGIN_INFO=AFmmF2sw...; __Secure-3PAPISID=AbCdEf/GhIjKl; ..."
```

On a hosting panel, paste the value into an environment variable field.

If you exported a cookies.txt file, keep it outside your repository and read it at startup:

```ts
import { YouTubePlugin } from "@distube/youtube";
import { Ytdl } from "@distube/ytdl-core";
import { readFileSync } from "node:fs";

const ytdl = new Ytdl({ cookie: readFileSync("youtube-cookies.txt", "utf8") });
export const youtube = new YouTubePlugin({ ytdl });
```

:::caution
Never commit the cookie. Anyone who has it can act as that account.
:::

### Pass the cookie to the plugin

Build a `Ytdl` with the cookie and give it to the plugin:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Ytdl } from "@distube/ytdl-core";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const youtube = new YouTubePlugin({ ytdl: new Ytdl({ cookie: process.env.YT_COOKIE }) });
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });

await distube.play(voiceChannel, "https://www.youtube.com/watch?v=<age-restricted video>", {
  allowAgeRestricted: true,
});
```

The plugin sends every search, lookup and stream request through that instance. The cookie gets YouTube to serve an
age-restricted video, but DisTube still refuses to queue one unless the call passes `allowAgeRestricted: true`.

### Confirm it works

`new Ytdl({ cookie })` throws a `YtdlError` with code `INVALID_ARGUMENT` when the value has no `SAPISID` or
`__Secure-3PAPISID` cookie. That is a signed-out copy, so copy it again while signed in.

For the real test, look up an age-restricted video. If the lookup returns formats, the cookie works. If it fails,
`error.attempts` lists every client that was tried, and the signed-in ones show `signedIn: true`:

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

The ytdl-core [error guide](https://distube.js.org/ytdl-core/guides/errors/) explains every field.

### When it stops working

Signing out of the browser session that made the cookie invalidates it. Keep that session signed in, or close its
window without signing out. YouTube can also expire a cookie on its own.

When the signed-in entries of `error.attempts` show `AUTH_FAILED`, YouTube is treating your cookie as signed out, even
if `error.code` is `AGE_RESTRICTED` or `BOT_CHECK`. Copy a fresh cookie and restart the process that uses it.

### How a failure reaches your bot

`distube.play` looks up a video link before it adds anything. Unless the call passes `allowAgeRestricted: true`, it
also looks up the top search result. A failure at that point rejects `play`. Playlist entries are not looked up first,
and a Song waiting in the queue may look YouTube up again when it starts, so those failures arrive later in the
`queue.item.failed` event as `error`.

Either way, the error looks like this:

- A bot check is a `DisTubeError` with code `BOT_CHECK`.
- A premiere that has not started has code `NOT_STARTED`, and `error.cause.startTime` says when it starts.
- An age gate has code `AGE_RESTRICTED`. DisTube uses the same code when a call does not allow age-restricted media.
- A refused cookie has code `SOURCE_FAILED`, because the plugin does not translate ytdl-core's `AUTH_FAILED` and
  DisTube wraps it. A refused cookie can also arrive as `AGE_RESTRICTED`, with `AUTH_FAILED` only on its signed-in
  attempts.

Every one of them keeps the original `YtdlError` as `error.cause`. This listener tells them apart:

```ts
import { YtdlError } from "@distube/ytdl-core";
import { type DisTube, DisTubeError, ErrorCode } from "distube";

declare const distube: DisTube<unknown>;

distube.on("queue.item.failed", ({ item, error }) => {
  const cause: unknown = error.cause;
  if (YtdlError.is(cause) && cause.attempts.some(attempt => attempt.signedIn && attempt.code === "AUTH_FAILED")) {
    console.error(`YouTube refused the cookie while preparing ${item.song.name}. Copy a fresh one.`);
  } else if (DisTubeError.is(error, ErrorCode.BOT_CHECK) || DisTubeError.is(error, ErrorCode.AGE_RESTRICTED)) {
    console.error(`YouTube wants a signed-in account for ${item.song.name}: ${error.code}`);
  } else if (DisTubeError.is(error, ErrorCode.NOT_STARTED)) {
    console.error(`${item.song.name} has not started yet.`);
  }
});
```

The same checks work on the error `distube.play` rejects with, with one exception. When the search for a query fails,
`play` rejects with the code every failure shares, or `SOURCE_FAILED` when they differ. Its `cause` is an
`AggregateError` whose `errors` hold the YouTube errors. The code checks still work there, but the `YtdlError.is(cause)`
check does not. [When every plugin failed](../../reference/errors/#when-every-plugin-failed) explains that shape.

The [play command](../../guides/play-command/) shows where to catch a `play` rejection. Every code is in the
[error reference](../../reference/errors/), and `queue.item.failed` is in the
[events reference](../../reference/events/).

To play a sound clip or a plain audio link instead of YouTube, see [sound clips](../../popular-topics/soundboard/) and
[direct links](../../popular-topics/direct-links/). No bot yet? Start with the
[quick start](../../get-started/quick-start/).
