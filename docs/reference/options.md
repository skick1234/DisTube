---
title: Options
description: Every DisTube constructor option, its default and what it does.
sidebar:
  order: 1
---

Everything you can pass to `new DisTube(options)`. Only `adapter` and `plugins` are required.

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

export const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
  historySize: 20,
  engine: { bufferMs: 400 },
});
```

| Option                  | Default  | What it does                                                                                                                       |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `adapter`               | required | Connects DisTube to your Discord library, such as `new DiscordJSAdapter(client)`.                                                  |
| `plugins`               | required | Your sources, in the order DisTube asks them. At most one may carry an `engine`, which replaces the built-in one.                  |
| `maxPlaylistSongs`      | 500      | How many Songs a Playlist from a URL keeps. The rest are dropped, not rejected.                                                    |
| `historySize`           | 10       | How many ended items each queue remembers. `0` turns history off.                                                                  |
| `filters`               | built-in | Filter presets to add to the built-in engine, or to replace its presets. See [Filters](#filters).                                  |
| `connectionTimeoutMs`   | 15000    | How long a voice join may take, in milliseconds.                                                                                   |
| `onDiagnostic`          | none     | A function that receives listener failures, core background failures and built-in engine reports. See [Diagnostics](#diagnostics). |
| `engine.opusComplexity` | 10       | Opus encoder complexity, 0 to 10. A lower value uses less CPU.                                                                     |
| `engine.bufferMs`       | 500      | How far ahead the engine reads, in milliseconds. A positive multiple of 20.                                                        |

`new DisTube<Metadata>(...)` also takes a type parameter for [queue item metadata](../queue/#metadata).

## The built-in engine

The `engine` section and `filters` tune the built-in engine that the adapter brings. A plugin that carries its own
engine, such as Lavalink, replaces it, and DisTube then ignores both.

`bufferMs` is added latency. The engine keeps `bufferMs / 20` packets ahead, so a volume or filter change becomes
audible up to `bufferMs` later.

## Playlist size

`maxPlaylistSongs` keeps the first Songs in the provider's order. Core applies it to every Playlist resolved from a
URL, and every official plugin applies it too. It does not cut a Playlist you build yourself and pass to `play` or
`queue.add`.

## What the constructor checks

The constructor throws `INVALID_ARGUMENT` when:

- `historySize` is not an integer of 0 or more.
- `maxPlaylistSongs` is not a positive integer.
- `connectionTimeoutMs` is not an integer from 1 to 2147483647.
- `engine.opusComplexity` is not an integer from 0 to 10.
- `engine.bufferMs` is not a positive multiple of 20.
- Two plugins share a name, a name is empty or has leading or trailing spaces, or more than one plugin carries an
  `engine`.
- A plugin has none of `resolve`, `search`, `stream` or `engine`.
- A plugin has no `stream` and nothing else can play its Songs.

A bad `filters` entry throws `TypeError` instead, as the next section lists.

## Filters

`filters` maps a preset name to its definition. Your definitions merge over the built-in presets, so you can add a
new one or replace a built-in one:

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;

export const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
  filters: {
    slowed: {
      render: (value = 0.85) => `atempo=${value}`,
      default: 0.85,
      min: 0.5,
      max: 1,
      label: "Slowed",
      tempo: (value = 0.85) => value,
    },
  },
});
```

A definition has these fields:

| Field                   | Meaning                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `render(value?)`        | Returns the libavfilter fragment for the preset, such as `bass=g=10`. Required.                                 |
| `default`, `min`, `max` | Give any of them and the preset takes a value, clamped to the range. Give none and the preset is fixed.         |
| `label`                 | The display name without the value, such as `Bass boost`. Defaults to the preset name.                          |
| `tempo`                 | Source seconds the preset plays per second of wall time. A number, or a function of the value. Defaults to `1`. |

Declare `tempo` on any preset that changes speed. The built-in `nightcore` and `vaporwave` declare `value => value`.
[Playback rate](../voice-and-filters/#playback-rate) explains how DisTube uses it.

:::caution
A definition with a built-in name replaces that preset entirely, label and tempo included. An override of `nightcore`
must declare `tempo` again, or `queue.playbackRate` reads `1` while the audio plays at another speed.
:::

The constructor throws `TypeError` when `render` is not a function, a bound is not a finite number, `min` is above
`max`, `default` is outside the range, `label` is not a string, or `tempo` is neither a function nor a finite number
above `0`.

## Diagnostics

`onDiagnostic(diagnostic)` receives one object per report:

| Field      | Meaning                                                                              |
| ---------- | ------------------------------------------------------------------------------------ |
| `severity` | `debug`, `info`, `warning` or `error`                                                |
| `stage`    | What reported, such as `engine.track.failed`. Filter on it together with `severity`. |
| `message`  | A readable summary. Do not parse it.                                                 |
| `plugin`   | The plugin that reported. Only a plugin's own option, such as Lavalink's, sets it.   |
| `guildId`  | The guild the report is about, when there is one                                     |
| `position` | Source seconds of that guild's current track                                         |
| `data`     | A flat record of strings, numbers and booleans that the stage defines                |
| `error`    | The error, when the report is about one                                              |

`data` never holds a resource, a playable URL, a header, a path or a token, so you can log it as it is.

DisTube delivers each engine report a microtask after the engine makes it, so your function may call `queue.skip()`
from inside it. A function that throws or rejects changes nothing about playback.

The built-in engine reports through `onDiagnostic` with no option of its own. An engine plugin such as Lavalink sends
its reports to its own `onDiagnostic` option instead. See [Lavalink options](../../plugins/lavalink/#options).

| Stage                  | Severity                       | When                                                                        | Fields                                               |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------------------- |
| `engine.track.failed`  | `error`                        | Once per failed track, before `queue.item.failed`                           | `guildId`, `position`, `data.step`, `error`          |
| `engine.input.retried` | `warning`                      | Each time a ranged URL read reopens because an answer ended early           | `guildId`, `position`, `data.offset`, `data.attempt` |
| `engine.track.starved` | `warning`                      | Each recovered stall of at least 100 ms in which no audio was ready to send | `guildId`, `position`, `data.durationMs`             |
| `engine.worker.load`   | `debug`, or `warning` from 0.9 | At most every 30 seconds per decoding worker that hosts a track             | `data.threadId`, `data.tracks`, `data.utilization`   |
| `event.listener`       | `error`                        | An event listener threw or rejected                                         | `error`                                              |
| `queue.*`, `voice.*`   | `error`                        | A core step that runs in the background failed, such as a voice release     | `error`                                              |

- `data.step` names the step that failed: `open`, `read`, `decode`, `seek` or `worker`, or `starved` when the
  platform gave up after 15 seconds without audio. Read it instead of the message. A stopped, skipped or released
  track reports nothing.
- `data.offset` is the byte the read reopened at, and `data.attempt` counts that track's reopens from `1`.
- A stall that ends in the 15-second failure appears only as `engine.track.failed`. Nothing reports per packet.
- `data.utilization` is the worker's event-loop utilization over the interval, from `0` to `1`. The severity turns
  `warning` at `0.9`. The stage has no `guildId`, because one worker hosts tracks of several guilds, and it reaches
  every client with a track on that worker. Runtimes that cannot read the utilization, such as Bun, report no load.
- The core background stages are `queue.loop`, `queue.resource.dispose`, `voice.resource.dispose`,
  `voice.session.release`, `voice.gateway`, `voice.disconnect` and `voice.player.release`. Their `message` names the
  guild, but they carry no `guildId` field.
