# Migrating to DisTube v6

DisTube v6 is intentionally breaking. There are no deprecated aliases, compatibility events, or shims. The surface is
deliberately v5-shaped: guild-keyed queues, `play` as the single insertion entry point, restored volume/repeat/
autoplay/filters, and a restored `Playlist`. This guide covers both audiences: v5 users, and adopters of the earlier
v6 pre-releases (queue-ID facades, `createQueue`/`enqueue`).

## The three lifetimes

Every migration question resolves to one of three lifetimes:

- **Voice** — the guild's voice presence. Created by `play` (or `voices.join`), it survives queue deletion and ends
  only through `voices.leave(guildId)`, a voice disconnect, or `shutdown()`.
- **GuildQueue** — one per guild, keyed by guild ID. Created by `play`, deleted by `queue.stop()`, by `voices.leave`,
  and automatically on exhaustion after `queue.finished`. A deleted queue's methods reject with `QUEUE_FAILED`;
  `getQueue` returns a fresh queue after the next `play`.
- **Track** — one `QueueItem` per occurrence of a `Song` in a queue, with core-assigned `id` and `addedAt`.

## Migrating from v5

| v5 surface | v6 replacement |
| --- | --- |
| `distube.play(voiceChannel, song, options)` | `distube.play({ guildId, voiceChannelId }, input, { position?, metadata?, skip? })` |
| `distube.getQueue(message \| guildId)` | `distube.getQueue(guildId)` |
| `distube.voices` (`DisTubeVoiceManager`) | `distube.voices` (`VoiceManager`): `join`, `borrow`, `get`, `has`, `leave`, iterable, `.size` |
| `queue.songs` (mutable array) | readonly `queue.state.items`; mutate with `enqueue`, `remove`, `jump`, `clear` |
| `queue.previousSongs` | `queue.previousSongs` (readonly) |
| `queue.skip()`, `queue.previous()` | unchanged in name; both return `Promise<void>` |
| `queue.jump(position)` | `queue.jump(target, { requeue? })` — one-based over *waiting* items (`jump(1)` is the next track) or an item ID |
| `queue.setRepeatMode(mode)` (numeric enum) | `queue.setRepeatMode(mode)` with string-valued `RepeatMode.Off \| Song \| Queue` |
| `queue.toggleAutoplay()` | `queue.setAutoplay(enabled)` |
| `queue.setVolume(v)` / `queue.volume` | unchanged; percent, default `100`, persisted on the guild's Player |
| `queue.filters` (`FilterManager`) | `queue.filters` (`QueueFilters`): `active`, `resolvable`, `apply`, `set`, `remove`, `clear` |
| `queue.seek(seconds)` / `queue.currentTime` | unchanged in name; `seek` is engine-granularity best-effort |
| `queue.pause()` / `queue.resume()` / `queue.paused` | `pause`/`resume` unchanged; read `queue.state.status` (`QueueStatus.Idle \| Playing \| Paused`) |
| `queue.stop()` | `queue.stop()` — now also deletes the queue (voice stays connected) |
| `queue.shuffle()` | `queue.shuffle()` — shuffles waiting items only |
| `distube.play` search-string handling | a string is offered to each SourcePlugin in constructor order; all declines reject with `SOURCE_FAILED` |
| `Playlist` | restored: playlist inputs insert their songs and emit one `queue.playlist.added` |

Events are a string-valued `Events` enum; subscribe with `distube.on(Events.X, listener)`:

| v5 event | v6 event |
| --- | --- |
| `initQueue` | `Events.QueueCreated` (`"queue.created"`) |
| `addSong` | `Events.QueueItemAdded` (`"queue.item.added"`), one per track |
| `addList` | `Events.QueuePlaylistAdded` (`"queue.playlist.added"`) |
| `playSong` | `Events.QueueItemStarted` (`"queue.item.started"`) |
| `finishSong` | `Events.QueueItemFinished` (`"queue.item.finished"`) |
| `error` (playback) | `Events.QueueItemFailed` (`"queue.item.failed"`) |
| `finish` | `Events.QueueFinished` (`"queue.finished"`), then `Events.QueueDeleted` |
| `noRelated` | `Events.QueueAutoplayFailed` (`"queue.autoplay.failed"`) |
| `deleteQueue` | `Events.QueueDeleted` (`"queue.deleted"`) |
| `disconnect` | `Events.VoiceDisconnected` (`"voice.disconnected"`) |
| `empty`, `searchNoResult`, ffmpeg/debug events | removed; use adapter policy or `onDiagnostic` |

## Migrating from the earlier v6 pre-releases

Mechanical mapping — every row is a rename or a merge, not a redesign:

| Pre-release surface | Reshaped v6 |
| --- | --- |
| `distube.createQueue({ guildId, channelId })` then `queue.enqueue(input)` | `distube.play({ guildId, voiceChannelId }, input, options?)` — upserts the queue, joins voice, inserts, returns `{ queue, items }` |
| `queue.enqueue(source)` for later insertions | still available for `Song`/`Playlist` values; strings go through `play` or `distube.resolve` |
| queue IDs / retained queue facades | guild IDs everywhere: `distube.getQueue(guildId)`, `distube.queues.size` |
| `queue.destroy()` | `queue.stop()` |
| `queue.destroyed` | queue deletion (`Events.QueueDeleted`); deleted-queue calls reject with `QUEUE_FAILED` |
| `"queue.destroyed"` event | `Events.QueueDeleted` (`"queue.deleted"`) |
| string event names | `Events` enum members (string-valued, so existing literals still compare equal) |
| idle queue after exhaustion | delete-on-exhaustion: `queue.finished` then `queue.deleted`; the Voice stays connected |
| `Adapter.createPlayer(binding)` | `Adapter.createVoiceSession(target)` + `Adapter.engine.createPlayer(session)` |
| `Player.stop()` | `Player.stopTrack()`; releasing voice is `VoiceSession.release()` |
| no volume/repeat/autoplay/filters | restored on GuildQueue (see the v5 table) |
| five error codes | six: `UNSUPPORTED` added for engine capabilities an adapter cannot express (e.g. Eris seek) |

## Adapter and engine authors

The playback engine is a plugin: `Adapter` exposes `createVoiceSession(target)` and a `readonly engine: Engine`;
`Engine` exposes `createPlayer(session)` and `resolvable(name)` for filter names. `Player` implements `position`,
`play({ itemId, resource })`, `pause`, `resume`, `stopTrack`, `seek`, `setVolume`, `setFilters(entries)`, and
`subscribe`. `VoiceSession` implements `guildId`, `channelId`, optional `gateway`, `join(channelId)`, `release()`, and
`subscribe`. Volume persists on the Player across queues in the same guild; filter state resets on queue deletion.
Correlate outcomes to `itemId`, own native resources, and never inspect Song/QueueItem or dispose the borrowed source
resource. An unsupported effect (such as Eris seek) rejects with `UNSUPPORTED`.

Official adapter packages are unchanged in name — `@distube/discordjs`, `@distube/oceanic`, `@distube/eris` — with the
same platform peer boundaries:

- `@distube/discordjs`: discord.js 14.26 or newer within major 14 and `@discordjs/voice` 0.19.x
- `@distube/oceanic`: Oceanic 1.14 or newer within major 1 and `@discordjs/voice` 0.19.x
- `@distube/eris`: Eris 0.18.x; voice needs `opusscript` or `@discordjs/opus`, plus FFmpeg for transcoding

## SourcePlugin authors

The contract is additive from the earlier v6 pre-releases: `name`, synchronous `initialize`, `dispose`, cancellable
`search`/`resolve`, required `preparePlayback(song, { signal })`, and now an optional `related(song, context)` used by
autoplay. `resolve` returns a `Song`, a `Playlist`, or `undefined` to decline; playlists carry their songs. Return a
fresh `{ kind: "resource", resource: { kind: "url", url, dispose } }` (an `{ kind: "encoded" }` resource exists for
engines that play encoded tracks) or an explicit `{ kind: "search", query }`. Keep `Song.url` canonical, never store a
stream on Song, and validate `song.source === name`. v5 extractor plugins map the same way they mapped to the
pre-releases: no PluginClass, roles, capabilities, or SDK.

Provider package status is unchanged: `@distube/youtube`, `@distube/spotify`, and `@distube/soundcloud` are the
maintained media plugins; other v5 provider packages are not in the maintained v6 release.

## Errors

One `DisTubeError` with six closed codes: `INVALID_ARGUMENT`, `SOURCE_FAILED`, `VOICE_FAILED`, `PLUGIN_FAILED`,
`QUEUE_FAILED`, and `UNSUPPORTED`. v5's typed error hierarchy and the pre-releases' five-code set both map onto these;
`UNSUPPORTED` is the only new code and marks capabilities the active playback backend cannot express.
