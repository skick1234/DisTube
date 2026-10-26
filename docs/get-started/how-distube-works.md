---
title: How DisTube works
description: The queue, the voice, what play does step by step and what survives a deleted queue.
sidebar:
  order: 3
---

Each guild has one queue and one voice.

## Queue and voice

`DisTubeQueue` decides what plays. It holds the current item, the upcoming items, the history, repeat and autoplay.
Only the queue starts a track, so a guild never plays two things at once. The [queue reference](../../reference/queue/)
lists its controls.

`DisTubeVoice` holds the connection and its settings: channel, volume, filters, self-deaf and self-mute. It plays
nothing. Get it from `queue.voice` or `distube.voices.get(guildId)`. The [voice reference](../../reference/voice-and-filters/)
lists its controls.

To play a short clip over music, add it as a Song with `next: true`. See [soundboard](../../recipes/soundboard/).

## What `play` does

```ts
import type { VoiceChannel } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;
declare const voiceChannel: VoiceChannel;

const pending = distube.play(voiceChannel, "https://youtu.be/example");
const registered = distube.getQueue(voiceChannel.guildId);
const queue = await pending;
console.log(queue === registered);
```

1. After a quick check of the arguments, `play` creates the guild's queue before it does anything slow. `getQueue`
   returns it at once, even while the media is still being looked up. It starts idle with nothing in it, and
   `queue.created` fires.
2. DisTube looks up the media, joins the voice channel or reuses the connection, and inserts the result.
3. The promise resolves with that queue once the item is in it. The track has not necessarily started.
4. Playback starts or fails later. Listen to `queue.item.started` and `queue.item.failed` for that. The
   [events reference](../../reference/events/) gives the order.

Calls for one guild insert in the order you made them. Other guilds do not wait. If the first insertion fails, nothing
else is pending and the queue is empty, DisTube deletes it with reason `failed`. No `queue.finished` fires. `queue.stop()` cancels a pending
`play`, which then rejects `INVALID_STATE` instead of filling a replacement queue.

`play`, `queue.add` and `distube.resolve` accept a search query, a URL, a `Song` or a `Playlist`. See
[plugin order](#plugins-and-their-order) for how a string finds its source. `distube.resolve` looks up the media
without creating a queue or joining voice.

## What survives a deleted queue

`queue.stop()`, running out of items, a failed first insertion, a lost voice session, a leave and `dispose()` all
delete the queue. The `reason` on `queue.deleted` says which. Running out of items keeps the voice connected, and so
does `stop()` unless the bot is still joining for the first time.

| Lives on the voice, kept after the queue goes | Lives on the queue, gone with it |
| --------------------------------------------- | -------------------------------- |
| volume, filters, self-deaf, self-mute         | current, upcoming, history       |
| the connection, until `leave`                 | repeat mode, autoplay            |

A later `play` creates a fresh queue over the same voice. `voice.leave()` or `distube.voices.leave(guildId)`
releases the voice and its settings, and the next connection starts from the defaults. DisTube never leaves on its
own; [leave voice](../../recipes/leave-when-empty/) shows how to leave after the queue ends. To reset filters when a queue ends, call
`voice.filters.clear()` from a `queue.deleted` listener. Controls on a deleted queue are listed on the
[queue reference](../../reference/queue/).

## Plugins and their order

The `plugins` array is the list of sources, in priority order.

- An absolute HTTP or HTTPS URL goes to each plugin's `resolve` in turn. The first plugin that returns a Song or
  Playlist wins. A URL no plugin resolves rejects `NO_RESULT` and is not retried as a search.
- Any other non-empty string goes to `search`. The first
  plugin that returns results wins, and the first result plays.
- When no plugin answers, the call rejects `NO_RESULT`. If some plugins failed while searching, it rejects
  `SOURCE_FAILED` with every failure in an `AggregateError` as the `cause`.
- A Song or Playlist whose `source` is not a configured plugin rejects `INVALID_ARGUMENT`.

Some plugins cannot stream. Spotify only knows tracks, so a Spotify Song keeps its Spotify URL, and when it is about
to play DisTube searches the other plugins in order for the track name and artist and plays the first result. The
Song in the queue stays the Spotify one. The [events reference](../../reference/events/) covers `fallback` and the
failure codes. List YouTube or SoundCloud with Spotify, or use Lavalink. The steps are in [plugin authoring](../../extending/plugin-authoring/#a-plugin-without-stream).

`dispose()` deletes every queue, releases every voice, then disposes the plugins in reverse order.
