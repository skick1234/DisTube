# Frequently asked questions

## Where is `play()`?

`distube.play({ guildId, voiceChannelId }, input, options?)` is the single creation-capable insertion entry point: it
upserts the guild's queue, joins or reuses the guild's Voice, and inserts the resolved media.

## How do I search?

Retain the typed source plugin instance and call its `search()` method directly, or pass a query string to `play` —
each configured SourcePlugin is offered the string in order.

## How do I move voice channels?

`distube.voices.get(guildId)` returns the guild's Voice; ask it to join the new channel. The queue is guild-keyed and
unaffected by channel moves.

## Where are filters, repeat, autoplay, and volume?

On the GuildQueue: `queue.filters` (`apply`/`set`/`remove`/`clear`, rendered by the playback engine),
`queue.setRepeatMode` with `RepeatMode`, `queue.setAutoplay`, and `queue.setVolume` (persisted on the guild's Player).

## What deletes a queue?

`queue.stop()`, `distube.voices.leave(guildId)`, shutdown, or exhaustion — after `Events.QueueFinished` the queue
deletes itself. The guild's Voice survives everything except `leave`, a platform disconnect, and shutdown.

## Which package handles voice?

The selected platform Adapter creates voice sessions and supplies the playback engine that creates Players. There is
no separate voice plugin.

Official choices are `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris`. Eris 0.18 needs an Opus
implementation for voice, and seek rejects with `UNSUPPORTED` because its supported voice API cannot seek a resource.

## Does DisTube send Discord replies?

No. Core and adapters publish state/events; application code sends user-facing messages.
