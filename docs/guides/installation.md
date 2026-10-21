---
title: Installation
description: Install DisTube, an adapter and plugins.
sidebar:
  order: 1
---

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Use `@distube/oceanic` instead of `@distube/discordjs` for Oceanic. The plugins are `@distube/youtube`,
`@distube/soundcloud`, `@distube/spotify` and `@distube/lavalink`.

Each adapter bundles the built-in engine, which decodes with the `node-av` native binding. It needs glibc 2.28 or
newer, so musl hosts such as Alpine are unsupported. A host that cannot load `node-av` fails the first playback
with `VOICE_FAILED`. The built-in engine decodes in a worker pool that takes `UV_THREADPOOL_SIZE - 1` permits
(at least one). Raise `UV_THREADPOOL_SIZE` above the default of 4 when the bot plays in many guilds at once.

Lavalink replaces the built-in engine, so a bot that uses it needs no local decoding. It requires Lavalink v4.2 or
newer within major 4.

All packages declare Node `^22.22.2 || ^24.15.0 || >=26.0.0`. Peer ranges are discord.js `^14.26.0` with `@discordjs/voice ^0.19.0`, and
Oceanic `^1.14.0` with the same voice peer. See [direct inputs](../direct-inputs/) for playing a file or stream
and [migration](../migration/) for the move from v5.
