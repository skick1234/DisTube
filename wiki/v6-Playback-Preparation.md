# v6 playback preparation

DisTube v6 separates canonical media identity from playable input. `Song.url` remains the provider page/permalink.
Immediately before activation, the exact owning SourcePlugin receives the Song and a required AbortSignal and returns
either a disposable playback resource (an HTTP(S) URL, or an encoded track for engines that play them) or an explicit
non-empty search query.

YouTube and SoundCloud reacquire fresh stream URLs for every attempt. Spotify returns its normalized title followed by
artists in provider order. Core visits configured sources in order, searches each eligible source once, tries at most
five ranked candidates per source, prevents source loops, and stops fallback after the first prepared resource. It
never falls back after unexplained original-source or Player failure.

Player receives only `{ itemId, resource }`. The item ID is always the original QueueItem, including Spotify fallback.
Player owns native audio objects and terminal connection cleanup but never calls the source resource's `dispose()`.
Core disposes that source resource exactly once after use or any stale/failed path.

`play()` and `enqueue()` acknowledge insertion. Playback start/failure arrives later through typed dotted client events. Stop
unregisters and fences the queue synchronously, aborts pending work, and joins track cleanup and source disposal.
Queue deletion also resets selected filters and backend rendering through the terminal cleanup barrier. Volume,
repeat and autoplay persist on the connected DisTubeVoice; later backend effects wait for old cleanup.
Late provider, Player, listener, timer, or cleanup completions cannot resurrect state or publish a duplicate item
event.

Queue registration happens before play returns its promise, even while resolution remains pending. Creation does
not imply insertion. Failed first acquisition deletes only its now-unowned empty queue and cannot disturb another
reservation or adopted voice. No late completion may move to a replacement queue.

Integrations import Player and resource/preparation types from the type-only distube/integrations entry point.
Application code uses DisTubeGuild and DisTubeVoice supplied by DisTube and never receives playback resources.
