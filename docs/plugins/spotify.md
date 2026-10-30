---
title: Spotify
description: Play Spotify links and search Spotify with @distube/spotify, through another source.
sidebar:
  order: 4
---

`@distube/spotify` lets members paste Spotify track, album, playlist and artist links and search Spotify. Spotify does
not hand out audio, so DisTube finds each track on one of your other plugins, such as YouTube, and plays it from
there. The plugin needs no account or API key.

## Install

Install it with a plugin that can play, such as YouTube:

```sh title="npm"
npm install @distube/spotify @distube/youtube
```

```sh title="Bun"
bun add @distube/spotify @distube/youtube
```

The [installation guide](../../get-started/installation/) covers `distube` and your adapter.

## Set it up

List Spotify and at least one plugin that can play. This example searches Spotify and plays the first result through
YouTube:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const youtube = new YouTubePlugin();
const spotify = new SpotifyPlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [spotify, youtube] });

const results = await distube.search("artist track", { source: spotify, limit: 5 });
const first = results[0];
if (first) await distube.play(voiceChannel, first);
```

`new DisTube` throws `INVALID_ARGUMENT` when no other plugin can play Spotify's tracks. `SpotifyPlugin` takes no
options. Short `spotify.link` links work like the full ones.

## Which plugin plays a track

When a Spotify track is about to play, DisTube searches its name and artists on your other plugins in `plugins` order
and plays the first match. To match against YouTube Music songs instead of videos, list
[`YouTubeMusicPlugin`](../youtube/#search-youtube-music) before `YouTubePlugin`.

The queue item stays a Spotify one. `queue.item.started` carries the match as `fallback`, so a now-playing message can
show what actually played:

```ts
import type { DisTube } from "distube";

declare const distube: DisTube<unknown>;

distube.on("queue.item.started", ({ item, fallback }) => {
  console.log(fallback ? `${item.song.name}, played from ${fallback.url}` : item.song.name);
});
```

When no plugin finds the track, the item fails with `NO_RESULT`.

## Autoplay

Spotify has no related tracks. After a Spotify track, autoplay asks the plugin that played its `fallback`, so with
YouTube it adds a related YouTube video. With [Lavalink](../lavalink/) there is no `fallback`, so autoplay after a
Spotify track fails and publishes `queue.autoplay.failed`.

:::caution
The plugin reads Spotify's public web pages without an account. Spotify can rate limit or change them at any time,
and links or search then fail with `RATE_LIMITED` or `SOURCE_FAILED` until the plugin is updated.
:::

## Errors

A failed Spotify lookup reaches your bot as a `DisTubeError` with `error.source` set to `"spotify"` and a code such as
`NOT_FOUND`, `UNAVAILABLE` or `RATE_LIMITED`. A failure while a track plays comes from the plugin that played it. The
[error reference](../../reference/errors/) lists every code.
