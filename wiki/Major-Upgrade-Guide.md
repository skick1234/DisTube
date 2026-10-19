# Migrating to DisTube v6

The client keeps direct playback: `distube.play(voiceChannel, input, options?)`. There is no mandatory guild selector
or replacement player facade. The client provides `DisTubeQueue` for scheduling and `DisTubeVoice` for the
connection, its Player and its settings. These changes are breaking; removed APIs have no compatibility aliases.
`MIGRATION.md` in the repository root has the row-by-row tables for v5 and for the v6 pre-release, with one code
line per row. This page summarises the model.

## Application API changes

| Earlier API | Replacement |
| --- | --- |
| `new DisTube(client, { plugins })` | `new DisTube({ adapter, sources, engine?, historySize? })`; source order is explicit |
| Automatic engine discovery in `plugins` | Pass the engine instance as `engine`, also in `sources` when it resolves media |
| `play({ guildId, voiceChannelId }, input)` | `play(voiceChannel, input, { metadata, signal, next, at })`; a structural target has `id` and `guildId` or `guild.id` |
| `const { queue, items } = await distube.play(...)` | `const queue = await distube.play(...)`; exact occurrences arrive in addition events |
| Guild lookup for a queue's voice | `queue.voice`, optional and bound to that queue's attachment |
| Queue factory, mandatory guild selector | Call `play`; use `getQueue(guildId)` or its returned `queue` |
| `GuildQueue`, `DisTubeGuild`, `Voice` | `DisTubeQueue`, `DisTubeVoice`, supplied by the client |
| `queue.songs`, `queue.state.upcoming` | `queue.current` and `queue.upcoming`; the current occurrence is separate |
| `queue.previousSongs` | `queue.history`, bounded by `historySize`, newest last |
| Queue ID lookup | `getQueue(guildId)`; queues have `guildId`, no random public queue ID |
| Index-only removal, `songs.splice` | `remove(itemId | index | { from, to })`, `move(itemId, beforeItemId?)` |
| `jump`, `previous`, `shuffle`, `clear` | Same names on `DisTubeQueue`; `jump(target, { requeue })` takes an ID or a one-based position |
| `addRelatedSong` | `queue.addRelated()` |
| `queue.setVolume`, `queue.volume` | `voice.setVolume`, `voice.volume` |
| `setRepeatMode`, `toggleAutoplay`, `voice.setRepeat` | `queue.setRepeat("off" | "song" | "queue")`, `queue.setAutoplay(boolean)` |
| `queue.filters.add(name)`, `voice.setFilters(names)` | `voice.filters.set(name, value?)`, `toggle`, `remove`, `clear`, `has`, `names`, `entries`, `definitions` |
| Runtime `RepeatMode`, `QueueStatus`, `Filters` enums | Literal modes, statuses and preset names |
| `Song.title`, `Playlist.title` | `name` |
| `song.views`, `song.uploader`, `song.isLive` | `song.pluginData` typed by the owning plugin (`YouTubeData.views`, `uploader`, `live`) |
| Mutable `queue.metadata`, `queue.textChannel` | Application-owned storage keyed by guild ID |
| Reassignable occurrence metadata | Readonly optional binding to caller-owned contents; use `DisTube<Metadata>` |
| `shutdown()` | `await distube.dispose()` |
| Runtime `Events` members | Typed dotted names such as `"queue.item.started"` |
| Chained `on`, `once`, `off`, `removeAllListeners` | Store the unsubscribe function returned by each `on` registration |
| `ErrorCode` enum, `errorCode`, `error.code === "..."` | `DisTubeError.is(error, ErrorCode.X)` and plugin codes such as `YouTubeErrorCode.NOT_FOUND` |
| Cancellation reported as `QUEUE_FAILED` | `ABORTED` for caller cancellation before commit |
| Bad-state `INVALID_ARGUMENT` with `reason` | `INVALID_STATE`; malformed values still use `INVALID_ARGUMENT` |
| Plugin errors reclassified to `SOURCE_FAILED` | Safe plugin `DisTubeError`s retain their code and cause; unsafe details are sanitized; an exhausted search is `NO_RESULT` |
| `distube.search(query, { type })`, `plugin.search` | `distube.search(query, { source, limit, offset })`, `distube.getSuggestions(query, source?)` |
| `ErisAdapter` `selfDeaf`/`selfMute` options | `voices.join(channel, { selfDeaf, selfMute })`, `voice.setSelfDeaf`, `voice.setSelfMute` |

The root exports application values and method-facing types. Extension authors use type-only imports from
`distube/integrations`; separate SDK/testkit packages and private implementation imports remain unsupported.

## Ownership and lifetime

`DisTubeVoice` owns the connection, the long-lived Player, volume, filters, self-deaf and self-mute, and exposes
`play`, `stop`, `pause`, `resume`, `seek` and `position` directly. It works without a queue. `DisTubeQueue` is a
scheduler over that voice: it owns `current`, `upcoming`, `history`, `repeat` and `autoplay`, calls `voice.play` and
listens to `voice.track.*`. While a queue is attached the five direct track controls reject `INVALID_STATE`;
`queue.stop()` detaches synchronously.

`play` copies channel IDs, validates shallow input and reserves the guild's queue synchronously before returning its
promise. `getQueue` and readonly queue iteration can observe an idle empty queue immediately. `queue.created`
acknowledges registration, not successful insertion or audible playback. Each call retains its original queue
identity. Stop unregisters and fences that queue immediately; late resolution cannot insert into a later replacement.

Queue exhaustion publishes `queue.finished` then `queue.deleted`. Stop and exhaustion retain the connected voice with
volume, filters, self-deaf and self-mute intact; repeat, autoplay and history die with the queue. Nothing on the
voice resets when a queue is deleted. `voice.leave()`, `voices.leave(guildId)`, terminal connection loss and `dispose` end voice
ownership. A later voice starts with volume 100, no filters, self-deaf true and self-mute false. Commands on deleted
queues or released voices reject `INVALID_STATE`.

## Media and metadata

`Song<PluginData>` contains `source`, `id`, `name`, canonical `url`, optional `duration`, `thumbnail` and
`artist`, plus `pluginData` filled by the owning plugin and a `formattedDuration` getter. `Playlist` contains
`source`, `id`, `name`, canonical `url`, optional `thumbnail`, readonly Songs, `pluginData`, `duration` and
`formattedDuration`. Core permits an absent duration; sources define their normalization. Keep signed URLs,
encoded tracks and playback state out of `pluginData`.

Core creates each QueueItem's ID and insertion timestamp at commit. Every successful insertion, natural repeat or
`previous()` creates a fresh occurrence. Its optional metadata binding is readonly but the referenced caller-owned
contents remain mutable, without recursive freezing or cloning.

## Adapter and engine authors

See the [Adapter authoring page](Adapter-Authoring.md). `createVoiceSession(target, options?)` receives `JoinOptions`, a
`VoiceSession` exposes `selfDeaf`, `selfMute`, `setSelfDeaf` and `setSelfMute`, and an `Engine` declares `accepts`,
`capabilities: { seek }`, a `filters` map of `FilterDefinitionInfo` and `createPlayer(session)`. Engines with
option-level limits may add the synchronous `supportsResource(resource)` predicate. `resolvable(name)`
is gone. The Player is created and released by the voice alone; queue deletion no longer clears filters.

Platform peer boundaries documented by the adapter packages:

- `@distube/discordjs`: discord.js 14.26 or newer within major 14, with `@discordjs/voice` 0.19.x.
- `@distube/oceanic`: Oceanic 1.14 or newer within major 1, with `@discordjs/voice` 0.19.x.
- `@distube/eris`: Eris 0.18.x, an Opus implementation and FFmpeg for transcoding.

All three provide local engines accepting files, progressive HTTP(S) URLs and Node readable streams.
Files and explicitly seekable URLs support seeking; streams do not. Explicit remote engine selection needs
no local FFmpeg, Opus or encryption runtime.

## Source authors

See the SourcePlugin authoring page. Required members are `name`, `stream` and at least one of `resolve` or `search`;
`related`, `suggest`, `initialize` and `dispose` are independently optional. Declare `SourcePlugin<PluginData>`
and fill `pluginData`. Export a `const` error-code object with your upper-case prefix and throw `DisTubeError` with
it; core passes those through. Constructors validate options only.

Maintained source packages are `@distube/youtube`, `@distube/spotify` and `@distube/soundcloud`; `@distube/lavalink`
provides the explicit remote source/engine option. See the package READMEs for provider bounds and native dependencies.
