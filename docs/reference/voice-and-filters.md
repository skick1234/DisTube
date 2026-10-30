---
title: Voice and filters
description: Volume, self-deaf, self-mute, moving, leaving, filter presets and the playback rate.
sidebar:
  order: 3
---

A `DisTubeVoice` is the bot's connection in one guild, with the settings that go with it: volume, filters, self-deaf
and self-mute. It plays nothing itself, because the queue does that. A voice outlives its queues, and
[how DisTube works](../../get-started/how-distube-works/#what-survives-a-deleted-queue) lists what it keeps after a
queue is deleted.

## Getting a voice

- `queue.voice`, once the queue's first item is added.
- `distube.voices.get(guildId)` for any connected guild, with or without a queue. `distube.voices.has(guildId)`
  checks, `distube.voices.size` counts them, and `for (const voice of distube.voices)` visits each one.
- `await distube.voices.join(channel, { selfDeaf?, selfMute?, signal? })` joins without a queue, or moves the guild's
  voice to `channel`. A new connection starts self-deafened and not self-muted. A flag you leave out keeps the voice's
  current setting.

Read the live settings from `voice.channelId`, `voice.volume`, `voice.selfDeaf`, `voice.selfMute` and
`voice.filters`. The speed of the selected filters is on the queue, as `queue.playbackRate`.

## Controls

| Method                                         | What it does                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `setVolume(percent)`                           | Set the volume, a finite number from 0 to 1000. The default is 100.                                                   |
| `setSelfDeaf(enabled)`, `setSelfMute(enabled)` | Update the bot's voice state without rejoining.                                                                       |
| `move(channel)`                                | Move to another channel in the same guild. The queue and the voice stay the same.                                     |
| `leave()`, `distube.voices.leave(guildId)`     | Delete the guild's queue, release the player and the connection, and publish `voice.disconnected` with reason `left`. |

- Above 100, the built-in engine amplifies and clips loud tracks. It has no limiter.
- The built-in engine encodes at the channel's bitrate and follows it after a move.
- `move` to a channel in another guild rejects `INVALID_ARGUMENT`.
- Calling `leave` again is harmless.

Volume and filter changes take effect once the player confirms them. When the player fails, the voice keeps the last
confirmed value and the call rejects `VOICE_FAILED`, or `UNSUPPORTED` when the engine cannot do it at all. The guides
cover both: [Volume and filters](../../guides/volume-and-filters/) and [Voice settings](../../guides/voice-settings/).

## Filters

`voice.filters` holds the presets that are on, in the order you turned them on.

| Member                    | What it does                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `set(name, value?)`       | Turn a preset on. A preset that is already on keeps its place and takes the new value. |
| `toggle(name, value?)`    | Turn a preset off when it is on, otherwise on                                          |
| `remove(name)`, `clear()` | Turn one preset off, or all of them                                                    |
| `has(name)`               | `true` when the preset is on                                                           |
| `names`                   | The names of the presets that are on                                                   |
| `entries`                 | The presets that are on, as `{ name, value?, label }`                                  |

`set`, `toggle`, `remove` and `clear` return promises. Leave out `value` and the preset uses its default.

`label` is a plain display name such as `Bass boost`. It never contains the value, so show `entry.value` next to it
yourself.

### The preset catalog

The engine owns the list of presets, so you read it from the client, not from a voice:

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

for (const [name, preset] of distube.filters) {
  console.log(name, preset.label, preset.acceptsValue ? `${preset.min} to ${preset.max}` : "fixed");
}
```

`distube.filters` maps each preset name to its `label`, `default`, `min`, `max` and `acceptsValue`. It is ready as
soon as the client exists, before any voice joins, so you can build slash command choices from it. Every voice of the
client accepts exactly those names.

The built-in presets are `3d`, `bassboost`, `earwax`, `echo`, `flanger`, `gate`, `haas`, `karaoke`, `mcompand`,
`nightcore`, `phaser`, `surround`, `tremolo` and `vaporwave`. Three of them take a value:

| Preset      | Label      | Default | Range    |
| ----------- | ---------- | ------- | -------- |
| `bassboost` | Bass boost | 10      | 0 to 20  |
| `nightcore` | Nightcore  | 1.25    | 1 to 2   |
| `vaporwave` | Vaporwave  | 0.8     | 0.5 to 1 |

The other presets are fixed, and their label is their name. Add or replace presets with the
[`filters` option](../options/#filters). An engine plugin such as Lavalink brings its own catalog.

### When a filter change fails

- A preset with a range clamps its value, so `voice.filters.set("bassboost", 15)` is safe with any finite number.
- A value that is not a finite number, such as `NaN`, rejects `INVALID_ARGUMENT`.
- A fixed preset given a value rejects `INVALID_ARGUMENT`.
- A name the engine does not know rejects `UNSUPPORTED`.
- A filter chain the built-in engine cannot build rejects `INVALID_ARGUMENT` and keeps the previous chain.
- So does a selection whose playback rate the engine refuses. The player receives no command.

## Playback rate

Some presets change how fast audio plays. The engine owns the rate of a selection, because only it knows how presets
combine.

`queue.playbackRate` is the number of source seconds the selection plays per second of wall time. It is `1` without a
voice or without such a filter. `queue.position` and the engine's position are source time, so under nightcore at
`1.25` they advance `1.25` seconds per second. Every filter change that takes effect publishes `queue.updated` with the
new rate.

In the built-in engine, `nightcore` and `vaporwave` have a tempo equal to their value, and every other preset has tempo
`1`. The rate of a selection is the product of its tempos, so nightcore at `1.25` with vaporwave at `0.8` plays at
`1`. A custom preset that changes speed declares `tempo` in the [`filters` option](../options/#filters). A preset
without it counts as `1`.
