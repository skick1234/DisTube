# Frequently asked questions

## Where is `play()`?

`distube.play({ guildId, voiceChannelId }, input, options?)` is the single creation-capable insertion entry point: it
upserts the guild's queue, joins or reuses the guild's Voice, and inserts the resolved media.

## How do I search?

Pass the query straight to `play` or `queue.enqueue`. Core searches your configured plugins in constructor order and
enqueues the first candidate the first answering plugin ranked. For a candidate list you present to the user before
committing to one, retain the typed plugin instance and call its own `search(query, options?)`, which takes a `limit`
and a zero-based `offset` the plugin documents bounds for.

## Why is my `spotify:track:…` URI treated as a query?

Because core only calls `resolve` for absolute `http:` and `https:` URLs. Any other scheme is indistinguishable from a
typed query like `artist: song title`, so it goes to search. Use the provider's HTTPS URL, or a plugin that accepts its
URI scheme in `search`.

## How do I move voice channels?

`distube.voices.get(guildId)` returns the guild's Voice; ask it to join the new channel. The queue is guild-keyed and
unaffected by channel moves.

## Where are filters, repeat, autoplay, and volume?

On the Voice, reached with `distube.voices.get(guildId)`: `voice.filters` (`apply`/`set`/`remove`/`clear`, rendered by
the playback engine), `voice.setRepeatMode` with `RepeatMode`, `voice.setAutoplay`, and `voice.setVolume`. All four are
guild presence state: they outlive every queue and reset only when the Voice leaves.

## What deletes a queue?

`queue.stop()`, `distube.voices.leave(guildId)`, shutdown, exhaustion, or a terminal platform Voice disconnect deletes
the queue. Exhaustion publishes `Events.QueueFinished` first. A terminal platform disconnect with an active item
publishes `Events.QueueItemFailed`, then `Events.QueueDeleted`, then `Events.VoiceDisconnected`. The guild's Voice
survives queue stop and exhaustion, but not `leave`, a platform disconnect, or shutdown.

## How does previous-track history work?

`voice.previousSongs` keeps at most 100 finished QueueItem occurrences and belongs to the Voice, so it survives queue
deletion and `queue.previous()` still works after the final item. `queue.previous()` inserts a fresh occurrence
for the selected Song, with a new item ID and timestamp while preserving the Song and metadata references. History
never revives an old QueueItem identity.

## Which package handles voice?

The selected platform Adapter creates voice sessions and supplies the playback engine that creates Players. There is
no separate voice plugin.

Official choices are `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris`. Eris 0.18 needs an Opus
implementation for voice, and seek rejects with `UNSUPPORTED` because its supported voice API cannot seek a resource.

## Does DisTube send Discord replies?

No. Core and adapters publish state/events; application code sends user-facing messages.
