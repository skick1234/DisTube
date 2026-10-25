---
title: Installation
description: Install DisTube with discord.js or Oceanic, using npm or Bun.
sidebar:
  order: 1
---

DisTube runs on Node.js `^22.22.2 || ^24.15.0 || >=26.0.0` or Bun. A bot needs `distube`, one adapter for its
Discord library and at least one source plugin. The commands below add YouTube; see [plugins](../../plugins/) for
SoundCloud, Spotify and Lavalink.

## discord.js

Requires discord.js `^14.26.0` and `@discordjs/voice ^0.19.0`.

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

Requires Oceanic `^1.14.0` and `@discordjs/voice ^0.19.0`.

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

```sh title="Node.js"
node index.js
```

```sh title="Bun"
bun index.ts
```

Node.js runs `index.ts` directly too when the file uses only erasable TypeScript syntax: types and `import type`,
but no `enum` or parameter properties. Otherwise compile it with `tsc` first.

## Built-in engine

Each adapter bundles the built-in engine, which decodes with the `node-av` native binding. It needs glibc 2.28 or
newer, so musl hosts such as Alpine are unsupported. A host that cannot load `node-av` fails the first playback
with `VOICE_FAILED`. The built-in engine decodes in a worker pool that takes `UV_THREADPOOL_SIZE - 1` permits
(at least one). Raise `UV_THREADPOOL_SIZE` above the default of 4 when the bot plays in many guilds at once.

Lavalink replaces the built-in engine, so a bot that uses it needs no local decoding. It requires Lavalink v4.2 or
newer within major 4.

Next: the [quick start](../quick-start/) builds a bot that plays, queues and controls volume. See
[direct inputs](../direct-inputs/) for clips and playback resources and [migration](../migration/) for the move from v5.
