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

The plugin installs `@distube/ytdl-core` for you. Add it yourself only when you import `Ytdl`, for example to
[sign in with a cookie](#sign-in-with-a-cookie). The [installation guide](../../get-started/installation/) covers
`distube` and your adapter.

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

A query that is not a link searches YouTube and plays the top result. Members can also paste:

- a video link, which plays the video;
- a playlist link, which plays the playlist;
- a channel link (`/@handle`, `/channel/UC...`, `/c/name` or `/user/name`), which plays the channel's uploads.

A playlist or channel stops at the `maxPlaylistSongs` option of `DisTube`.

## Options

`new YouTubePlugin()` takes two optional fields.

`preferPlaylist` decides what a watch link that also names a playlist plays, such as `watch?v=...&list=PL...`. It is
`false` by default, so the link plays the video. Set it to `true` to play the playlist instead.

`ytdl` is the `Ytdl` instance from `@distube/ytdl-core` that the plugin sends every request through. Pass your own to
set a cookie, a PO token provider, a proxy `fetch` or a language. You create it, so you dispose it.

## Search YouTube Music

`YouTubeMusicPlugin` searches YouTube Music's songs instead of videos, suggests its completions and continues autoplay
from its radio. Give both plugins one `Ytdl` and pick the catalog per call with `source`:

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

Keep both plugins in the array, with `YouTubeMusicPlugin` first:

- It handles `music.youtube.com` watch and playlist links. Everything else on YouTube goes to `YouTubePlugin`.
- A search without `source` asks the plugins in order, so listing it first makes music search your default.
- [Spotify](../spotify/) matches its tracks against YouTube Music songs instead of videos.

## Age-restricted videos

DisTube refuses to queue an age-restricted video unless the call passes `allowAgeRestricted: true`:

```ts
import type { DisTube } from "distube";
import type { VoiceBasedChannel } from "discord.js";

declare const distube: DisTube;
declare const voiceChannel: VoiceBasedChannel;
declare const url: string;

await distube.play(voiceChannel, url, { allowAgeRestricted: true });
```

YouTube itself also serves those videos only to a signed-in, age-verified account, so you need a
[cookie](#sign-in-with-a-cookie) as well.

## Sign in with a cookie

A cookie fixes two failures:

- `AGE_RESTRICTED`: the video needs a signed-in, age-verified account.
- `BOT_CHECK`: YouTube answered "Sign in to confirm you're not a bot", which is common on datacenter and VPS
  addresses. A [PO token provider](https://distube.js.org/ytdl-core/guides/po-tokens/) can get past it too.

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
signed in to the throwaway account. Pass the file's text as the cookie.

### Store the cookie

The value contains `;` and `=`, so put it in double quotes in a `.env` file:

```dotenv title=".env"
YT_COOKIE="SAPISID=AbCdEf/GhIjKl; LOGIN_INFO=AFmmF2sw...; __Secure-3PAPISID=AbCdEf/GhIjKl; ..."
```

On a hosting panel, paste the value into an environment variable field. Keep a cookies.txt file outside your
repository and read it at startup with `readFileSync("youtube-cookies.txt", "utf8")`.

:::caution
Never commit the cookie. Anyone who has it can act as that account.
:::

### Pass the cookie to the plugin

Build a `Ytdl` with the cookie and give it to the plugin:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Ytdl } from "@distube/ytdl-core";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

const youtube = new YouTubePlugin({ ytdl: new Ytdl({ cookie: process.env.YT_COOKIE }) });
export const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
```

### Check that it works

`new Ytdl({ cookie })` throws `INVALID_ARGUMENT` when the value has no `SAPISID` or `__Secure-3PAPISID` cookie. That
is a signed-out copy, so copy it again while signed in.

Then look up an age-restricted video. If it fails, the signed-in attempts in `error.attempts` tell you why:

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

### When it stops working

YouTube can expire a cookie, and signing out of the browser session that made it invalidates it at once. When the
signed-in attempts show `AUTH_FAILED`, copy a fresh cookie and restart the bot. This listener spots that while the bot
runs:

```ts
import { YtdlError } from "@distube/ytdl-core";
import type { DisTube } from "distube";

declare const distube: DisTube<unknown>;

distube.on("queue.item.failed", ({ item, error }) => {
  const cause: unknown = error.cause;
  if (YtdlError.is(cause) && cause.attempts.some(attempt => attempt.signedIn && attempt.code === "AUTH_FAILED")) {
    console.error(`YouTube refused the cookie while preparing ${item.song.name}. Copy a fresh one.`);
  }
});
```

## Errors

A YouTube failure reaches your bot as a `DisTubeError` with `error.source` set to `"youtube"`, or `"youtube-music"`
for the music plugin.

| Code             | What happened                                                                     | What to do                                      |
| ---------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- |
| `NOT_FOUND`      | The video or playlist does not exist                                              | Check the link                                  |
| `UNAVAILABLE`    | The video is private, members-only, Premium-only, region-blocked or has no format | Pick another video                              |
| `AGE_RESTRICTED` | The video needs a signed-in, age-verified account                                 | [Sign in with a cookie](#sign-in-with-a-cookie) |
| `NOT_STARTED`    | A premiere or scheduled live stream has not started                               | Try again once it starts                        |
| `BOT_CHECK`      | YouTube answered "Sign in to confirm you're not a bot"                            | [Sign in with a cookie](#sign-in-with-a-cookie) |
| `RATE_LIMITED`   | YouTube is throttling your bot                                                    | Wait, or slow down your requests                |

The [play command](../../guides/play-command/) shows where to catch a failed `play`, and the
[error reference](../../reference/errors/) lists every code.
