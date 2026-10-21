---
title: Frequently asked questions
description: Answers to common questions about playback, queues and sources.
sidebar:
  order: 9
---

## How do I start playback?

Call `distube.play(voiceChannel, input, options?)` with the native channel object you already have. It registers
the guild queue immediately, then resolves media, joins or reuses voice and inserts. The result is the queue.
Pass `{ next: true }` to insert at the front of `upcoming`, or `{ at }` for a zero-based position.

## Why does lookup return an empty queue before play resolves?

Registration is synchronous. The queue is idle with no items until the insertion commits. `queue.created` does not
mean the request succeeded. If the first insertion fails, the queue is deleted with `queue.deleted` reason
`failed`. Stop prevents that request's late result from entering a replacement queue.

## How do I search or autocomplete?

Pass a query to `play`, `queue.add` or `distube.resolve` and core takes the first plugin that answers, in `plugins`
order. To show choices, call `distube.search(query, { source: youtube, limit: 5 })` with the plugin instance you
configured. Results are typed by that plugin's `pluginData`. For slash-command autocomplete call
`distube.getSuggestions(query, youtube)`. A query no plugin answers rejects `NO_RESULT`.

## Why is a provider URI treated as a query?

Only absolute HTTP(S) URLs go to `resolve`. Other strings, including `spotify:track:…`, go to `search`. Use the
provider's HTTPS URL, or a plugin that accepts the URI scheme in `search`. A URL no plugin resolves rejects
`NO_RESULT` and is not retried as a query.

## How do I move voice channels?

Get `distube.voices.get(guildId)` and call `voice.move(channel)`. The channel must be in the same guild. The queue
and the voice stay the same. You can also join without a queue with `distube.voices.join(channel, { selfDeaf,
selfMute })`.

## Which settings survive queue deletion?

Volume, bitrate, filters, self-deaf and self-mute live on `DisTubeVoice` and last until `voice.leave()` or
`distube.voices.leave(guildId)`. Change them with `voice.setVolume`, `voice.setBitrate`, `voice.filters.set(name,
value?)`, `voice.setSelfDeaf` and `voice.setSelfMute`. Repeat, autoplay and history live on the queue and go with
it. To clear filters when a queue ends, call `voice.filters.clear()` from a `queue.deleted` listener.

## How do I set a filter with a strength?

`voice.filters.set("bassboost", 15)`. Ranged presets clamp the value. Fixed presets reject one with
`INVALID_ARGUMENT`. Read `voice.filters.definitions` for each preset's `default`, `min`, `max`, `acceptsValue` and
`label(value)`, and `voice.filters.entries` for the selected ones with labels such as `Bass +15dB`.

## What deletes a queue?

Stop, running out of items, a failed first insertion, voice leave, a lost voice session, a direct `voice.play`
that replaces the queue's track, and `distube.dispose()`. The `reason` on `queue.deleted` says which. Stop and
running out of items keep the voice connected.

## How do I go back or jump?

`queue.previous()` replays the newest Song in `queue.history` as a fresh item and puts the current item back at
the front of `upcoming`. `queue.jump(3)` starts the third waiting item. Pass `{ requeue: true }` to keep the
skipped items at the tail instead of sending them to history. History holds `historySize` items (default 10).

## Can the bot play a sound without a queue?

Yes. `const voice = await distube.voices.join(channel)`, then `await voice.play({ kind: "file", path })`. The
promise resolves with `{ reason }` when the track ends. If a queue is playing on that voice, the clip replaces the
track and the queue is deleted with reason `replaced`.

## Which package handles voice?

The Adapter creates the voice session and supplies the built-in engine. The official adapters are
`@distube/discordjs` and `@distube/oceanic`. A plugin with an `engine`, such as Lavalink, replaces the built-in
engine. Put it in `plugins` like any other source.

## Does DisTube send Discord replies?

No. Application code sends messages from typed events and handles `DisTubeError` codes with `DisTubeError.is`.
`on` returns an unsubscribe function. Call `await distube.dispose()` when the bot stops.
