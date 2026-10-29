---
title: Installation
description: Install DisTube with discord.js or Oceanic, using npm or Bun.
sidebar:
  order: 1
---

DisTube runs on Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` or Bun. A bot needs `distube`, one adapter for its
Discord library and at least one source plugin. The commands below add YouTube. See [plugins](../../plugins/) for
SoundCloud, Spotify, yt-dlp and Lavalink.

## discord.js

Requires discord.js `^14.26.0` and `@discordjs/voice ^0.19.1`.

```sh title="npm"
npm install distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});
```

## Oceanic

Requires Oceanic `^1.14.0` and `@discordjs/voice ^0.19.1`.

```sh title="npm"
npm install distube @distube/oceanic @distube/youtube @distube/ytdl-core oceanic.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/oceanic @distube/youtube @distube/ytdl-core oceanic.js @discordjs/voice
```

```ts
import { OceanicAdapter } from "@distube/oceanic";
import { YouTubePlugin } from "@distube/youtube";
import { DisTube } from "distube";
import { Client } from "oceanic.js";

const client = new Client({
  auth: `Bot ${process.env.TOKEN}`,
  gateway: { intents: ["GUILDS", "GUILD_VOICE_STATES"] },
});
const distube = new DisTube({
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

Node.js runs `index.ts` directly too when the file uses only erasable TypeScript syntax: types and `import type`,
but no `enum` or parameter properties. Otherwise compile it to JavaScript first.

## Hosting

Each adapter bundles the built-in engine, which decodes with the `node-av` native binding. The adapters list `node-av`
as an optional dependency, so a package manager that skips optional packages or cannot install it still installs the
bot. It needs glibc 2.28 or newer, so musl hosts such as Alpine are unsupported. A host that cannot load `node-av`
fails the first playback with `VOICE_FAILED`.

A bot that plays live streams or starts tracks in many guilds at once may need a larger thread pool, especially on
Node.js, whose default is 4 threads. See [size the thread pool](../../recipes/thread-pool/).

Lavalink replaces the built-in engine, so a bot that uses it needs no local decoding and no `node-av`. It requires Lavalink v4.2 or
newer within major 4.

Next, the [quick start](../quick-start/) builds a bot that plays, skips and stops. Coming from v5? Read the
[migration guide](../migration/).
