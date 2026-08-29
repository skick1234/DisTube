# Migrating to DisTube v6

DisTube v6 is intentionally breaking. There are no deprecated aliases, compatibility events, or shims. The surface is
deliberately v5-shaped: guild-keyed queues, `play` as the single insertion entry point, volume/repeat/autoplay/filters
restored (on `Voice`), and a restored `Playlist`. This guide covers both audiences: v5 users, and adopters of the earlier
v6 pre-releases that exposed queue-ID facades and a separate queue factory.

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
| `distube.voices` (`DisTubeVoiceManager`) | `distube.voices` (`VoiceManager`): `join`, `get`, `has`, `leave`, iterable, `.size` |
| `queue.songs` (mutable array) | readonly `queue.state.items`; mutate with `enqueue`, `remove`, `jump`, `clear` |
| `queue.previousSongs` | `voice.previousSongs` (readonly, at most 100 occurrences, outlives the queue) |
| `queue.skip()`, `queue.previous()` | unchanged in name; both return `Promise<void>` |
| `queue.jump(position)` | `queue.jump(target, { requeue? })` — zero-based over *waiting* items (`jump(0)` is the next track) or an item ID |
| `queue.setRepeatMode(mode)` (numeric enum) | `voice.setRepeatMode(mode)` with string-valued `RepeatMode.Off \| Song \| Queue` |
| `queue.toggleAutoplay()` | `voice.setAutoplay(enabled)` |
| `queue.setVolume(v)` / `queue.volume` | `voice.setVolume(v)` / `voice.volume`; percent, default `100` |
| `queue.filters` (`FilterManager`) | `voice.filters` (`VoiceFilters`): `active`, `resolvable`, `apply`, `set`, `remove`, `clear` |
| `queue.seek(seconds)` / `queue.currentTime` | unchanged in name; `seek` is engine-granularity best-effort |
| `queue.pause()` / `queue.resume()` / `queue.paused` | `pause`/`resume` unchanged; read `queue.state.status` (`QueueStatus.Idle \| Playing \| Paused`) |
| `queue.stop()` | `queue.stop()` — now also deletes the queue (voice stays connected) |
| `queue.shuffle()` | `queue.shuffle()` — shuffles waiting items only |
| `distube.play` search-string handling | a string is offered to each SourcePlugin in constructor order; all declines reject with `SOURCE_FAILED` |
| `Playlist` | restored: playlist inputs insert their songs and emit one `queue.playlist.added` |
| `queue.id` | removed; queues are keyed by guild, so use `guildId` and `distube.getQueue(guildId)` |
| untyped `metadata` | `new DisTube<Metadata>()` types `options.metadata` and every `metadata` handed back |

`voice` in those rows is `distube.voices.get(guildId)`. Volume, repeat mode, autoplay, filters, and played history are
guild presence state, so they moved off `GuildQueue` and onto `Voice`: they survive `queue.stop()` and exhaustion, the
next `play()` inherits them with no re-application, and only `distube.voices.leave(guildId)` discards them.

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
| separate queue factory followed by `queue.enqueue(input)` | `distube.play({ guildId, voiceChannelId }, input, options?)` upserts the queue, joins voice, inserts, and returns `{ queue, items }` |
| `queue.enqueue(source)` for later insertions | still accepts a URL or query string, `Song`, or `Playlist` on an existing live queue |
| queue IDs / retained queue facades | guild IDs everywhere: `distube.getQueue(guildId)`, `distube.queues.size` |
| `queue.destroy()` | `queue.stop()` |
| `queue.destroyed` | queue deletion (`Events.QueueDeleted`); deleted-queue calls reject with `QUEUE_FAILED` |
| `"queue.destroyed"` event | `Events.QueueDeleted` (`"queue.deleted"`) |
| string event names | `Events` enum members (string-valued, so existing literals still compare equal) |
| idle queue after exhaustion | delete-on-exhaustion: `queue.finished` then `queue.deleted`; the Voice stays connected |
| `Adapter.createPlayer(binding)` | `Adapter.createVoiceSession(target)` + `Adapter.engine.createPlayer(session)` |
| `Player.stop()` | `Player.stopTrack()`; releasing voice is `VoiceSession.release()` |
| no volume/repeat/autoplay/filters | restored on Voice (see the v5 table) |
| five error codes | six: `UNSUPPORTED` added for engine capabilities an adapter cannot express (e.g. Eris seek) |
| `INVALID_ARGUMENT` alone | plus `error.reason`: `ErrorReason.Argument` for a bad value, `ErrorReason.State` for a call the queue forbids |
| `off` could not remove a `once` listener | `off` matches the function you passed either way, and `removeAllListeners(name?)` clears in bulk |
| one-based `jump` | zero-based everywhere: `enqueue({ position })`, `remove(index)`, `remove({ from, to })`, and `jump(position)` all index the waiting items directly |

## Breaking corrections from the v6 pre-releases

Three contract corrections affect integrations that called provider or adapter APIs directly:

- `SourcePlugin.search` rejects an empty or whitespace-only query with `INVALID_ARGUMENT`. Validate user input or handle
  that error; an empty result is still the decline response for a valid query.
- `Engine.accepts` describes the current configuration. Lavalink includes `"url"` only when
  `trustedUrlLoading: true`; inspect the set before sending a URL resource instead of assuming every engine accepts it.
- `VoiceSession` now requires the readonly `clientUserId` alongside `guildId` and `channelId`. Custom Adapters must
  provide the connected bot user's ID so engine Plugins can authenticate without a separate identity option.

## Adapter and engine authors

Every Adapter supplies the default playback `Engine` alongside `createVoiceSession(target)`. An engine-capable Plugin
may replace that default. `Engine` exposes `createPlayer(session)` and `resolvable(name)` for filter names. `Player`
implements `position`, `play({ itemId, resource })`, `pause`, `resume`, `stopTrack`, `seek`, `setVolume`,
`setFilters(entries)`, `subscribe`, and terminal `release()`. `VoiceSession` implements `guildId`, the readonly
`clientUserId`, `channelId`, optional `gateway`, `join(channelId)`, `release()`, and `subscribe`. Core applies committed
volume and filters to a Player once,
when it first becomes the guild's playback Player and again only when a value changes or the Engine supplies a
replacement, so a Player never sees the same effect replayed per track.
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
