# Frequently asked questions

## How do I start playback?

Call `distube.play(voiceChannel, input, options?)` with the native channel object you already have. It registers and
reserves the guild queue immediately, then resolves media, joins or reuses voice and inserts. The result contains
`queue` and inserted `items`. A prior guild selector or explicit join is unnecessary.

## Why does lookup return an empty queue before play resolves?

Registration is synchronous after shallow validation. The queue is idle with no current or upcoming items until
insertion commits. `queue.created` does not mean the request succeeded. If failed initial work leaves no playback or
other pending insertion, the queue is deleted without `queue.finished`. Stop prevents that request's late result
from entering a replacement queue.

## How do I search?

Pass a query to `play`, `queue.enqueue` or `distube.resolve`. Core searches configured `sources` in constructor order
and uses the first answering source's candidate ranking. To present choices to users, retain the source instance and
call its `search(query, { limit, offset })`; each provider documents its bounds.

## Why is a provider URI treated as a query?

Only absolute HTTP(S) URLs use URL resolution. Other strings, including `spotify:track:…`, use search. Use the
provider HTTPS URL or a source that accepts its URI scheme in search. Declined URLs are not retried as queries.

## How do I move voice channels?

Get `distube.voices.get(guildId)` and call `voice.move(channel)`. The target must belong to the same guild and pass
adapter voice-capability validation. Movement retains queue and voice identity. You can independently join through
`distube.voices.join(channel)` without creating a queue.

## Which settings survive queue deletion?

`DisTubeVoice.settings` contains volume, repeat, autoplay and filters. Change them with `setVolume`, `setRepeat`,
`setAutoplay` and `setFilters`. Volume, repeat and autoplay persist while voice remains connected. Successful queue
deletion clears selected filters and backend rendering. A failed reset reports cleanup failure and retains last
acknowledged filter state. Leaving voice destroys all settings; the next voice starts with defaults.

## What deletes a queue?

Stop, exhaustion, failed empty initial acquisition, voice leave, terminal connection loss and client disposal.
Exhaustion publishes `queue.finished` first. A terminal disconnect with an active item publishes
`queue.item.failed`, `queue.deleted`, then `voice.disconnected`. Stop and exhaustion keep voice connected.
Pending insertion reservations prevent premature exhaustion.

## How do I replay something from history?

Keep application history from committed events and enqueue its retained Song with the desired metadata reference.
Every insertion creates a fresh occurrence ID and timestamp. The library does not expose a history or previous-track
API. Keep other application guild state in your own storage as well.

## Which package handles voice?

The Adapter creates voice sessions and supplies the default engine. Official adapters are `@distube/discordjs`,
`@distube/oceanic` and `@distube/eris`. An explicit `engine` option selects a remote engine such as Lavalink. A
source/engine instance supplied in both roles initializes and disposes once. No separate voice plugin is required.
Eris 0.18 needs an Opus implementation; seek rejects `UNSUPPORTED` because its native API cannot seek a resource.

## Does DisTube send Discord replies?

No. Application code sends messages using typed dotted events and handles `DisTubeError` codes. `on` returns an
unsubscribe function. Call `await distube.dispose()` when the bot stops.
