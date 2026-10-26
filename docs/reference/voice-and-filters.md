---
title: Voice and filters
description: Volume, self-deaf, self-mute, moving, leaving, filter presets and search.
sidebar:
  order: 3
---

`DisTubeVoice` holds the connection and its settings and plays nothing. What it keeps after a queue is deleted is on
[how DisTube works](../../get-started/how-distube-works/#what-survives-a-deleted-queue).

## Getting a voice

- `queue.voice`, or `distube.voices.get(guildId)`.
- `await distube.voices.join(channel, { selfDeaf?, selfMute?, signal? })` joins without a queue. The options apply
  only when the join creates the connection. Self-deaf defaults to on and self-mute to off.

Read the live `channelId`, `volume`, `selfDeaf`, `selfMute` and `filters`.

## Controls

| Method                                         | Effect                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setVolume(percent)`                           | A finite number from 0 to 1000, default 100. Above 100 the built-in engine amplifies and clips loud tracks. There is no limiter.                       |
| `setSelfDeaf(enabled)`, `setSelfMute(enabled)` | Update the bot's voice state without rejoining. The encoder follows the channel's bitrate.                                                             |
| `move(channel)`                                | Moves within the same guild. The queue and the voice stay the same.                                                                                    |
| `leave()`, `distube.voices.leave(guildId)`     | Delete the attached queue, release the player and the connection, and publish `voice.disconnected` with reason `left`. Calling them again is harmless. |

Volume and filter changes take effect once the player confirms. A failure keeps the last confirmed value and rejects
`VOICE_FAILED`, or `UNSUPPORTED` when the engine cannot do it. Recipes: [volume and filters](../../recipes/volume-and-filters/),
[voice settings](../../recipes/voice-settings/).

## Filters

`voice.filters` manages the active presets.

| Member                    | Meaning                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `set(name, value?)`       | Turn a preset on, optionally with a strength                                  |
| `toggle(name, value?)`    | Switch a preset on or off                                                     |
| `remove(name)`, `clear()` | Remove one preset or all                                                      |
| `has(name)`, `names`      | Check or list the active presets                                              |
| `entries`                 | Active presets as `{ name, value?, label }`, with labels such as `Bass +15dB` |
| `definitions`             | Each preset's `default`, `min`, `max`, `acceptsValue` and `label()`           |

A ranged preset clamps its value, so `voice.filters.set("bassboost", 15)` is safe. A fixed preset rejects a value with
`INVALID_ARGUMENT`. A preset the engine does not render rejects `UNSUPPORTED`. A filter chain the built-in engine
cannot build rejects `INVALID_ARGUMENT` and keeps the previous chain.

The built-in presets are `3d`, `bassboost`, `earwax`, `echo`, `flanger`, `gate`, `haas`, `karaoke`, `mcompand`,
`nightcore`, `phaser`, `surround`, `tremolo` and `vaporwave`. Add or override presets with the top-level
[`filters` option](../options/).
