# Frequently asked questions

## How do I start playback?

Call `distube.play(voiceChannel, input, options?)` with the native channel object you already have. It registers and
reserves the guild queue immediately, then resolves media, joins or reuses voice and inserts. The result is the queue itself. Use committed addition events for exact inserted occurrences. Pass `{ next: true }` to put the input at the front of `upcoming`, or `{ at }` for a
zero-based position.

## Why does lookup return an empty queue before play resolves?

Registration is synchronous after shallow validation. The queue is idle with no current or upcoming items until
insertion commits. `queue.created` does not mean the request succeeded. If failed initial work leaves no playback or
other pending insertion, the queue is deleted without `queue.finished`. Stop prevents that request's late result
from entering a replacement queue.

## How do I search or autocomplete?

Pass a query to `play`, `queue.add` or `distube.resolve` and core takes the first answering source in constructor
order. To show choices, call `distube.search(query, { source: youtube, limit: 5 })` with the plugin instance you
configured; results are typed by that plugin's `pluginData`. For slash-command autocomplete call
`distube.getSuggestions(query, youtube)`, which returns provider completions as strings. A query no source answers
rejects `NO_RESULT`.

## Why is a provider URI treated as a query?

Only absolute HTTP(S) URLs use URL resolution. Other strings, including `spotify:track:…`, use search. Use the
provider HTTPS URL or a source that accepts its URI scheme in search. Declined URLs are not retried as queries.

## How do I move voice channels?

Get `distube.voices.get(guildId)` and call `voice.move(channel)`. The target must belong to the same guild and pass
adapter voice-capability validation. Movement retains queue and voice identity. You can independently join through
`distube.voices.join(channel, { selfDeaf, selfMute })` without creating a queue.

## Which settings survive queue deletion?

Volume, filters, self-deaf and self-mute live on `DisTubeVoice` and persist until `voice.leave()` or `distube.voices.leave(guildId)`.
Change them with `voice.setVolume`, `voice.filters.set(name, value?)`, `voice.setSelfDeaf` and `voice.setSelfMute`.
Repeat and autoplay live on the queue and reset when it is deleted. To clear filters when a queue ends, call
`voice.filters.clear()` from a `queue.deleted` listener.

## How do I set a filter with a strength?

`voice.filters.set("bassboost", 15)`. Ranged presets clamp the value; fixed presets reject one with
`INVALID_ARGUMENT`. Read `voice.filters.definitions` for each preset's `default`, `min`, `max`, `acceptsValue` and
`label(value)`, and `voice.filters.entries` for the selected ones with rendered labels such as `Bass +15dB`.

## What deletes a queue?

Stop, exhaustion, failed empty initial acquisition, voice leave, terminal connection loss and client disposal.
Exhaustion publishes `queue.finished` first. A terminal disconnect with an active item publishes
`voice.track.failed`, `queue.item.failed`, `queue.deleted`, then `voice.disconnected`. Stop and exhaustion keep voice
connected and detach the queue, so `voice.play` works again afterwards.

## How do I go back or jump?

`queue.previous()` replays the newest Song in `queue.history` as a fresh occurrence and puts the current item back
at the front of `upcoming`. `queue.jump(3)` starts the third waiting item; pass `{ requeue: true }` to keep the
skipped items at the tail instead of sending them to history. History is bounded by `historySize` (default 10) and
cleared with the queue.

## Can the bot play a sound without a queue?

Yes. `const voice = await distube.voices.join(channel)` then `await voice.play({ kind: "url", url, dispose })`.
The voice publishes `voice.track.started` and `voice.track.finished` or `voice.track.failed`. While a queue is
attached to that voice, direct `play`, `stop`, `pause`, `resume` and `seek` reject `INVALID_STATE`.

## Which package handles voice?

The Adapter creates voice sessions and supplies the default engine. Official adapters are `@distube/discordjs`,
`@distube/oceanic` and `@distube/eris`. An explicit `engine` option selects a remote engine such as Lavalink. A
source/engine instance supplied in both roles initializes and disposes once. No separate voice plugin is required.
Local engines support seeking files and URLs marked `seekable: true`. Read `voice.seekable` for the active
track. Seeking a URL reopens it and decodes/discards audio up to the requested offset, so large seeks cost time
and bandwidth. Streams cannot seek.

## Does DisTube send Discord replies?

No. Application code sends messages using typed dotted events and handles `DisTubeError` codes with
`DisTubeError.is`. `on` returns an unsubscribe function. Call `await distube.dispose()` when the bot stops.
