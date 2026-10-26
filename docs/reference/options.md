---
title: Options
description: Every DisTube constructor option, its default and what it does.
sidebar:
  order: 1
---

Pass options to `new DisTube(options)`. An invalid option makes the constructor throw `INVALID_ARGUMENT`.

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
  historySize: 20,
  engine: { bufferMs: 400 },
});
```

| Option                  | Default  | Meaning                                                                                                  |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `adapter`               | none     | The platform Adapter. Required.                                                                          |
| `plugins`               | none     | Ordered array of sources. At most one may carry an `engine`, which replaces the built-in one. Required.  |
| `maxPlaylistSongs`      | 500      | Songs kept from a Playlist resolved from a URL. Core and official plugins truncate instead of rejecting. |
| `historySize`           | 10       | Ended items each queue remembers. `0` disables history.                                                  |
| `filters`               | built-in | Filter presets merged over the built-in engine's. Ignored when an engine plugin is configured.           |
| `connectionTimeoutMs`   | 15000    | How long a voice join waits.                                                                             |
| `onDiagnostic`          | none     | Receives listener failures and plugin diagnostics.                                                       |
| `engine.opusComplexity` | 10       | Opus encoder complexity, 0 to 10. Lower uses less CPU.                                                   |
| `engine.bufferMs`       | 500      | Read-ahead in milliseconds, a positive multiple of 20.                                                   |

The `engine` section and `filters` configure the built-in engine only. They have no effect when a plugin such as
Lavalink carries its own engine.

`bufferMs` is added latency. The engine keeps `bufferMs / 20` packets ahead, so a volume or filter change becomes
audible up to `bufferMs` later.

`maxPlaylistSongs` does not cut a Playlist you pass to `play` or `add` yourself.

`DisTube` takes one more type parameter for [queue item metadata](../queue/#metadata).
