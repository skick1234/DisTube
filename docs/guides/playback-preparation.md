---
title: v6 playback preparation
description: How v6 separates media identity from playable input.
---

DisTube v6 separates canonical media identity from playable input. `Song.url` remains the provider page/permalink.
Immediately before activation, the exact owning SourcePlugin receives the Song and a required AbortSignal through
`stream(song, context)` and returns either a fresh single-use playback resource (`url`, absolute `file`, Node
`stream`, or format-qualified `encoded`) or an explicit non-empty search query. Before creating a Player, core
checks the selected engine's accepted kinds, encoded formats and optional `supportsResource` predicate. A Player
borrows the resource; core owns cleanup.

YouTube and SoundCloud reacquire fresh stream URLs for every attempt. Spotify returns its normalized title followed by
artists in provider order. Core visits configured sources in order, searches each eligible source once, tries at most
five ranked candidates per source, prevents source loops, and stops fallback after the first compatible prepared
resource. It never falls back after unexplained original-source or Player failure.

The Player receives only `{ itemId, resource }`. Its `itemId` is an opaque private correlation ID unique to each
play, not a QueueItem ID. The Player echoes it unchanged in track outcomes. `DisTubeVoice` maps those outcomes to
the caller-supplied public `itemId`; queue playback keeps the original QueueItem ID, including Spotify fallback.
The Player owns native audio objects and terminal connection cleanup but never calls the source resource's
`dispose()`. Core disposes that source resource exactly once after use or any stale/failed path.

The queue hands the prepared resource to `voice.play(resource, { itemId })` and learns the outcome from the voice's
`voice.track.*` events. The voice owns one long-lived Player per connection; a queue never borrows it. Direct
`voice.play` from application code uses the same path with a caller-supplied resource and no queue.

`play()` and `queue.add()` acknowledge insertion. Playback start/failure arrives later through typed dotted client
events. Stop detaches the queue from its voice and fences the queue synchronously, aborts pending work, and joins
track cleanup and source disposal. Queue deletion leaves volume, filters, self-deaf and self-mute on the connected
DisTubeVoice untouched. Late provider, Player, listener, timer, or cleanup completions cannot resurrect state or
publish a duplicate item event.

Queue registration happens before play returns its promise, even while resolution remains pending. Creation does
not imply insertion. Failed first acquisition deletes only its now-unowned empty queue and cannot disturb another
reservation or adopted voice. No late completion may move to a replacement queue.

Integrations import Player and resource/preparation types from the type-only `distube/integrations` entry point.
Application code uses `DisTubeQueue` and `DisTubeVoice` supplied by DisTube; it only handles a playback resource
when it calls `voice.play` itself.
