---
title: Lavalink
description: Configure remote playback and source lookup with @distube/lavalink.
sidebar:
  order: 5
---

`@distube/lavalink` moves audio work off your bot's process. [Lavalink](https://lavalink.dev/) servers, called nodes,
load the tracks and stream them to Discord, and your bot only sends commands. The plugin works with a pool of Lavalink
v4.2 or later v4 nodes. It is both a source plugin, which resolves links and searches through the nodes, and a playback
engine.

Reach for it when the built-in engine costs your bot too much CPU, or when you already run Lavalink.

## Install

This page's example also uses SoundCloud:

```sh title="npm"
npm install @distube/lavalink @distube/soundcloud
```

```sh title="Bun"
bun add @distube/lavalink @distube/soundcloud
```

You also need a running Lavalink node. The [installation guide](../../get-started/installation/) covers `distube` and
your adapter.

## Set it up

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { LavalinkPlugin } from "@distube/lavalink";
import { SoundCloudPlugin } from "@distube/soundcloud";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [
    new SoundCloudPlugin(),
    new LavalinkPlugin({
      nodes: [{ host: "127.0.0.1", port: 2333, password: "youshallnotpass" }],
    }),
  ],
});

await distube.play(voiceChannel, "a song title");
```

Listing the plugin is enough to replace the built-in engine. Remote playback needs no local decoder.

Source plugins still resolve links and search in array order. Put Lavalink last to let the dedicated plugins own their
providers, or first to let the nodes resolve links before them. Lavalink alone is enough when your nodes can load
everything your members paste.

## How Lavalink prepares a Song

Lavalink prepares every Song itself, whichever plugin found it. It tries two steps and stops at the first one that
loads a track:

1. Load the Song's page URL with `loadtracks(song.url)`.
2. Search for `<searchPrefix>:<name> <artist>` and take the first hit.

It never calls a source plugin's `stream`. So a SoundCloud or Spotify Song that the node cannot load by its URL plays
the first search hit instead. When both steps fail, preparation rejects `SOURCE_FAILED`, with an `AggregateError` of
the two failures as `cause`.

## Options

`new LavalinkPlugin()` takes one required field and six optional ones.

`nodes` is the pool, a non-empty list. Each node needs `host` and `password`, and `port` defaults to 2333. Set
`secure` for TLS, and `identifier` to name the node in diagnostics. The plugin takes your bot's user ID from the
adapter's voice session, so you never pass it.

`searchPrefix` turns a query into a node search, `ytsearch` by default. Enable the matching search source on your
nodes.

`reconnect` sets `retries`, `backoffMs` and `maxBackoffMs`. By default a node retries forever, waiting 1000 ms at first
and at most 30000 ms between attempts, with jitter.

`resume.timeoutSeconds` is how long a node keeps a dropped session's players alive, 60 by default. Set it to `0` to
turn session resume off.

`failover` decides what happens to a playing track when its node is gone. The default, `"migrate"`, continues it on
another ready node with its position and audio settings intact. `"fail"`, or having no other node, rejects playback
with `VOICE_FAILED`.

:::caution
Migration replays the encoded track on another node, so every node in the pool needs the same sources and Lavalink
plugins.
:::

`filters` adds Lavalink filter presets or overrides built-in ones. See [filters](#filters).

`onDiagnostic` receives node failures, reconnects, resumes and migrations. The plugin writes nothing to process output
on its own, so pass a function here if you want to see them.

## Links and search

A link that loads a track becomes one Song. A link that loads a playlist becomes a Playlist of at most
`maxPlaylistSongs` Songs. Search loads `<searchPrefix>:<query>` and returns at most 100 results. The plugin has no
`related`, so after a Song it found, autoplay publishes `queue.autoplay.failed`.

## Filters

Filters are native Lavalink filters, so only presets with a native Lavalink equivalent are built in:

- Presets: `3d`, `bassboost`, `earwax`, `haas`, `karaoke`, `nightcore`, `surround`, `tremolo` and `vaporwave`.
- Native filters with an adjustable value: `equalizer`, `timescale`, `vibrato`, `rotation`, `distortion`,
  `channelMix` and `lowPass`.

`distube.filters` lists them with plain labels, such as `Nightcore`, without any value.

Each change sends one filter update that deep-merges the selection, with the last preset winning per field.
`queue.playbackRate` is the merged `timescale` payload's `speed` times its `rate`, each `1` when absent. So nightcore at
`1.25` then vaporwave at `0.8` reads `0.8`. Nightcore then `timescale` at `1.5` reads `1.5`, because `timescale` sets
`rate` back to `1`. The Player advances `position` between node updates at that rate, so the queue's clock stays
smooth under nightcore.

A definition in the `filters` option replaces the preset of the same name, label included. It takes no `tempo`, and
construction throws `TypeError` if it has one, because the rate comes from the `timescale` payload.

## Players and errors

A new Player uses the least-loaded ready node that passed its version check. Playback rejects `VOICE_FAILED` when no
node is available.

Preparation returns `encoded` resources with format `lavalink.v4`. The Player rejects any other resource with
`UNSUPPORTED`. It never uploads or proxies media. Because Lavalink prepares every Song, a
[sound clip](../../popular-topics/soundboard/) goes through the same two steps as any other Song, and your clip
plugin's `stream` never runs.

Plugin failures are `DisTubeError` instances with `error.source` set to `"lavalink"`. The
[error reference](../../reference/errors/) lists every code, and
[voice and filters](../../reference/voice-and-filters/) covers filter controls.
