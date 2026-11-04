---
title: Lavalink
description: Play through Lavalink nodes instead of your bot's process with @distube/lavalink.
sidebar:
  order: 5
---

`@distube/lavalink` moves audio work off your bot's process. [Lavalink](https://lavalink.dev/) servers, called nodes,
load the tracks and stream them to Discord, and your bot only sends commands. Reach for it when the built-in engine
costs your bot too much CPU, or when you already run Lavalink. It needs Lavalink v4.2 or a later v4.

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

Listing the plugin replaces the built-in engine, so every Song plays on a node. The plugin also resolves links and
searches through your nodes. Put it last to let your other plugins handle their own links, or first to let the nodes
handle links before them. Lavalink alone is enough when your nodes can load everything your members paste.

## Set up your nodes

A node plays each Song by loading its link. When that fails, it searches `<name> <artist>` with `searchPrefix` and
plays the first hit. So enable a source on your nodes for every site your members use, and one for `searchPrefix`.
Your other plugins only find Songs here; they never play them.

## Options

`nodes` is required: a non-empty list. Each node needs `host` and `password`, and `port` defaults to 2333. Set
`secure: true` for TLS, and `identifier` to name the node in diagnostics.

The rest are optional:

- `searchPrefix` is the node search used for queries, `ytsearch` by default. Enable that search source on your nodes.
- `reconnect` sets `retries`, `backoffMs` and `maxBackoffMs`. By default a node retries forever, waiting 1 second at
  first and at most 30 seconds between attempts.
- `resume.timeoutSeconds` is how long a node keeps a dropped session's players alive, 60 by default. Set it to `0` to
  turn session resume off.
- `failover` decides what happens to a playing track when its node goes away. `"migrate"`, the default, moves it to
  another node at the same position. `"fail"` ends it with `VOICE_FAILED`.
- `filters` adds or replaces filter presets. See [filters](#filters).
- `onDiagnostic` receives node failures, reconnects, resumes and migrations. The plugin logs nothing on its own, so
  pass a function to see them.

:::caution
`"migrate"` replays the track on another node, so every node in the pool needs the same sources and Lavalink plugins.
:::

## Filters

The filters are Lavalink's own:

- Presets: `3d`, `bassboost`, `earwax`, `haas`, `karaoke`, `nightcore`, `surround`, `tremolo` and `vaporwave`.
- Filters that take a value: `equalizer`, `timescale`, `vibrato`, `rotation`, `distortion`, `channelMix` and
  `lowPass`.

`distube.filters` lists them. To add a preset or replace a built-in one, pass it in the `filters` option under its
name. `render` returns the [Lavalink filter payload](https://lavalink.dev/api/rest.html#filters) for the value:

```ts
import { LavalinkPlugin } from "@distube/lavalink";

export const lavalink = new LavalinkPlugin({
  nodes: [{ host: "127.0.0.1", password: "youshallnotpass" }],
  filters: {
    slowed: {
      default: 0.85,
      min: 0.5,
      max: 1,
      label: "Slowed",
      render: value => ({ timescale: { speed: value ?? 0.85 } }),
    },
  },
});
```

[Voice and filters](../../reference/voice-and-filters/) shows how to apply them.

## Things that work differently

- Autoplay needs a plugin with related tracks. A Song the Lavalink plugin found has none, and a Spotify track played on
  a node has no `fallback`, so autoplay after them publishes `queue.autoplay.failed`.
- A [sound clip](../../popular-topics/soundboard/) also plays on a node, so the node must be able to load its link.
- When no node is ready, playback rejects `VOICE_FAILED`.

Plugin failures are `DisTubeError` instances with `error.source` set to `"lavalink"`. The
[error reference](../../reference/errors/) lists every code.
