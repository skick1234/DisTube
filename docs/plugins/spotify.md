---
title: Spotify
description: Resolve Spotify metadata and play it through another source with @distube/spotify.
sidebar:
  order: 4
---

`@distube/spotify` lets members paste Spotify links and search Spotify. It reads tracks, albums, playlists and an
artist's top tracks. Spotify does not hand out audio, though, so the plugin only supplies names and artists. DisTube
finds each track on another plugin, such as YouTube, and plays it from there.

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

If no other plugin has both `search` and `stream`, and no engine plugin such as Lavalink is listed, `new DisTube`
throws `INVALID_ARGUMENT`, because nothing could play Spotify's Songs.

`SpotifyPlugin` takes no options and no credentials. Short `spotify.link` and `spotify.app.link` links expand to the
URL they share, which then plays as if the member pasted it.

## How a Spotify Song plays

When a Spotify Song is about to play, DisTube searches for its name and artists on every other plugin that has both
`search` and `stream`, in the order of `plugins`, taking one result from each. It plays the first result that
prepares. List `YouTubeMusicPlugin` before `YouTubePlugin` to match against YouTube Music songs instead of videos.

The queue item and its Song stay Spotify's. `queue.item.started` carries the matched Song as `fallback`, so your
now-playing message can show which video actually played.

If no plugin finds anything, the item fails `NO_RESULT`. If some of them failed, the item fails with the code every
failure shares, such as `RATE_LIMITED`, or `SOURCE_FAILED` when they differ. The error's `cause` is an `AggregateError`
of the failures, each keeping the code and source of the plugin that failed, so none of them is a Spotify error. When
every failure came from one plugin, `error.source` names it. Either way, `error.query` holds the text DisTube searched
for.

An engine plugin such as [Lavalink](../lavalink/) prepares every Song itself, so this search never runs.

## Autoplay

Spotify has no related tracks. After a Spotify Song, autoplay asks the plugin that played its `fallback` instead,
seeded with that fallback Song. With YouTube, that adds a related video. The added item is a YouTube Song, not a
Spotify one.

When the Spotify Song played with no fallback, as it does through Lavalink, autoplay publishes
`queue.autoplay.failed`. An item that failed is never used as the autoplay seed.

## Where the data comes from

Links resolve from Spotify's public `open.spotify.com/embed` page, which lists up to 100 tracks of a playlist or album
and an artist's top tracks. Search and the full track list of a playlist, album or artist go through the web player's
pathfinder API, with the anonymous token the embed page carries.

:::caution
That token is unofficial, and Spotify can rate limit it or close it at any time. When the pathfinder API fails while
listing a playlist, album or artist, the plugin falls back to the tracks the embed page lists.
:::

## Songs, playlists and search results

Songs carry Spotify's explicit flag as `song.ageRestricted`, and the album name as `album` in typed `pluginData` when
Spotify reports it. A Playlist's `pluginData.kind` says which page it came from: `"album"`, `"playlist"` or
`"artist"`.

Playlists and albums keep their first `maxPlaylistSongs` tracks. They skip local files, podcast episodes and tracks
Spotify marks unplayable.

Search returns at most 50 results per call, and `offset` counts from zero. Spotify stops at the 1000th result, so an
offset of 1000 or more returns nothing.

## Errors

A Spotify lookup failure reaches your bot as a `DisTubeError` with `error.source` set to `"spotify"` and a code such as
`NOT_FOUND`, `UNAVAILABLE` or `RATE_LIMITED`. A failed track lookup sets `error.media` to `"song"`, and a failed
playlist, album or artist lookup sets it to `"playlist"`. A refused token sets no `media`.

Failures while playing come from the plugin that played the track, as [above](#how-a-spotify-song-plays). The
[error reference](../../reference/errors/) lists every code. New to DisTube? Start with the
[quick start](../../get-started/quick-start/).
