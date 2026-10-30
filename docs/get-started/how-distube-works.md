---
title: How DisTube works
description: The queue, the voice, what play does step by step and what survives a deleted queue.
sidebar:
  order: 4
---

This page explains the two objects you work with in every guild, what happens between calling `play` and hearing
music, and how DisTube picks a plugin. You don't need it to build the quick-start bot, but it answers most "why did
that happen?" questions.

## Queue and voice

Each guild has at most one queue and one voice. They split the work between them.

`DisTubeQueue` decides what plays. It holds the current item, the upcoming items, the history, repeat and autoplay.
Only the queue starts a track, so a guild never plays two things at once. The [queue reference](../../reference/queue/)
lists its controls.

`DisTubeVoice` holds the connection and its settings: the channel, volume, filters, self-deaf and self-mute. It plays
nothing itself. Get it from `queue.voice` or `distube.voices.get(guildId)`. The
[voice reference](../../reference/voice-and-filters/) lists its controls.

:::tip
Want a short sound clip over the music? Because only the queue plays, a clip is a Song you add with `next: true`.
[Sound clips](../../popular-topics/soundboard/) shows how.
:::

## What `play` does

```ts
import type { VoiceChannel } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;
declare const voiceChannel: VoiceChannel;

const pending = distube.play(voiceChannel, "https://youtu.be/example");
const registered = distube.getQueue(voiceChannel.guildId);
const { queue, items } = await pending;
console.log(queue === registered, items.length);
```

1. `play` checks its arguments, then creates the guild's queue before it does anything slow. `getQueue` returns that
   queue right away, even while the media is still being looked up. The queue starts `idle` and empty, and
   `queue.created` fires.
2. DisTube looks up the media, joins the voice channel or reuses the connection, and inserts the result.
3. The promise resolves `{ queue, items }` once the items are in the queue. `queue` is that same queue, and `items`
   are the items this call added, in order. The first track has not necessarily started yet. From the first insertion
   until the track is audible, the queue reads `preparing`; see [status](../../reference/queue/#status).
4. Playback starts or fails later. Listen to `queue.item.started` and `queue.item.failed` to hear about it. The
   [events reference](../../reference/events/) gives the order.

Calls for one guild insert in the order you made them. Other guilds do not wait.

If the first insertion fails while nothing else is pending and the queue is empty, DisTube deletes the queue with
reason `failed`. No `queue.finished` fires.

`queue.stop()` cancels a pending `play`. That `play` then rejects `INVALID_STATE`, so it never fills a replacement
queue.

`play`, `queue.add` and `distube.resolve` accept a search query, a URL, a `Song` or a `Playlist`.
[Plugins and their order](#plugins-and-their-order) explains how a string finds its source. `distube.resolve` looks
up the media without creating a queue or joining voice.

## What survives a deleted queue

These all delete the queue:

- `queue.stop()`
- running out of items
- a failed first insertion
- a lost voice session
- a leave
- `dispose()`

The `reason` on `queue.deleted` says which one happened. Running out of items keeps the voice connected. So does
`stop()`, unless the bot is still joining for the first time.

| Lives on the voice, kept after the queue goes | Lives on the queue, gone with it |
| --------------------------------------------- | -------------------------------- |
| volume, filters, self-deaf, self-mute         | current, upcoming, history       |
| the connection, until `leave`                 | repeat mode, autoplay            |

A later `play` creates a fresh queue over the same voice. `voice.leave()` or `distube.voices.leave(guildId)`
releases the voice and its settings, and the next connection starts from the defaults.

DisTube never leaves on its own. [Leave voice](../../guides/leave-when-empty/) shows how to leave after the queue
ends.

To reset filters when a queue ends, call `voice.filters.clear()` from a `queue.deleted` listener. The
[queue reference](../../reference/queue/) lists what each control does on a deleted queue.

## Plugins and their order

The `plugins` array is the list of sources, in priority order.

- An absolute HTTP or HTTPS URL goes to each plugin's `resolve` in turn. The first plugin that returns a Song or
  Playlist wins. A URL that no plugin resolves rejects `NO_RESULT`, and DisTube does not retry it as a search.
- Any other non-empty string goes to `search`. The first plugin that returns results wins, and its first result
  plays.
- When no plugin answers, the call rejects `NO_RESULT`. If some plugins failed while searching, it rejects with the
  code every failure shares, such as `RATE_LIMITED`, or `SOURCE_FAILED` when the codes differ. Every failure is in
  an `AggregateError` on `cause`. See [exhaustion](../../reference/errors/#when-every-plugin-failed).
- A Song or Playlist whose `source` is not a configured plugin rejects `INVALID_ARGUMENT`.

Some plugins cannot stream. Spotify only knows track details, so a Spotify Song keeps its Spotify URL. When it is
about to play, DisTube searches the other plugins in order for the track name and artist, and plays the first
result. The Song in the queue stays the Spotify one. The [events reference](../../reference/events/) covers
`fallback` and the failure codes.

:::note
List YouTube or SoundCloud next to Spotify, or use Lavalink, so a Spotify Song has something to play through.
[Plugin authoring](../../extending/plugin-authoring/#a-plugin-without-stream) covers how a plugin without `stream`
works.
:::

`dispose()` deletes every queue, releases every voice, then disposes the plugins in reverse order.

## Next

Ready to grow the quick-start bot? Start with [command handling](../../guides/command-handling/).
