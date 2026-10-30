---
title: Installation
description: Install DisTube with discord.js or Oceanic, using npm or Bun.
sidebar:
  order: 2
---

This page installs DisTube into your bot and creates the DisTube client. Check the
[prerequisites](../introduction/#before-you-start) first.

A DisTube bot needs three kinds of package:

- `distube`, the core. It owns the queues and the events.
- One adapter for your Discord library, `@distube/discordjs` or `@distube/oceanic`. The adapter joins voice channels
  and carries the built-in playback engine.
- At least one source plugin. A plugin is how DisTube finds media, so without one it has nothing to play.

The commands below add the YouTube plugin. The [plugins](../../plugins/) page covers SoundCloud, Spotify, yt-dlp and
Lavalink.

## discord.js

The discord.js adapter needs discord.js `^14.26.0` and `@discordjs/voice ^0.19.1`.

```sh title="npm"
npm install distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Create DisTube next to your client. The adapter wraps the client, and the plugin goes in the `plugins` array.

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
export const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});
```

## Oceanic

The Oceanic adapter needs Oceanic `^1.14.0` and `@discordjs/voice ^0.19.1`.

```sh title="npm"
npm install distube @distube/oceanic @distube/youtube oceanic.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/oceanic @distube/youtube oceanic.js @discordjs/voice
```

```ts title="index.ts"
import { OceanicAdapter } from "@distube/oceanic";
import { YouTubePlugin } from "@distube/youtube";
import { DisTube } from "distube";
import { Client } from "oceanic.js";

const client = new Client({
  auth: `Bot ${process.env.TOKEN}`,
  gateway: { intents: ["GUILDS", "GUILD_VOICE_STATES"] },
});
export const distube = new DisTube({
  adapter: new OceanicAdapter(client),
  plugins: [new YouTubePlugin()],
});
```

## Run the bot

DisTube loads with `import` in an ES module bot and with `require()` in a CommonJS bot.

```sh title="Node.js"
node index.js
```

```sh title="Bun"
bun index.ts
```

Node.js can run `index.ts` directly too, as long as the file uses only erasable TypeScript syntax. Types and
`import type` are fine. An `enum` or a constructor parameter property is not, so compile a file that uses them to
JavaScript first.

## Hosting

Each adapter bundles the built-in engine, which decodes audio with the `node-av` native binding. The adapters list
`node-av` as an optional dependency. A package manager that skips optional packages, or cannot install this one, still
installs the bot.

`node-av` needs glibc 2.28 or newer, so musl hosts such as Alpine are unsupported. On a host that cannot load
`node-av`, the first playback fails with `VOICE_FAILED`.

A bot that plays live streams or starts tracks in many guilds at once may need a larger thread pool. This matters most
on Node.js, whose default is 4 threads. See [size the thread pool](../../popular-topics/thread-pool/).

Lavalink replaces the built-in engine, so a bot that uses it needs no local decoding and no `node-av`. It requires
Lavalink v4.2 or newer within major 4.

Need a server? The Premium DisTube Bots run on the VPS provider at [skick.xyz/vps](https://skick.xyz/vps), in
Chicago. Every plan has AMD EPYC Milan CPUs, Samsung enterprise NVMe storage and a 10 or 40 Gbps port, in 16
locations. The smallest plan is US$4 a month for 1 vCore, 2 GB RAM and 10 GB storage.

## Next

The [quick start](../quick-start/) builds a bot that plays, skips and stops. Coming from v5? Read
[updating from v5](../migration/).
