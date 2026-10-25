---
title: Migration
description: Move from DisTube v5 to v6, and update plugins, adapters and engines.
sidebar:
  order: 10
---

v6 removes aliases for the APIs it replaces. A music command starts with
`const queue = await distube.play(voiceChannel, input)`. `DisTubeQueue` schedules `current`, `upcoming`, `history`,
`repeat` and `autoplay`. `queue.voice` is the `DisTubeVoice` that owns the connection, volume, filters,
self-deaf and self-mute.

## Applications

| v5                                                                | v6                                                                                                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `new DisTube(client, { plugins: [new YouTubePlugin()] })`         | `new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [new YouTubePlugin()] })`                                              |
| `@distube/eris`                                                   | removed; use `@distube/discordjs` or `@distube/oceanic`                                                                               |
| `ytdlOptions`, `emitNewSongOnly`, `leaveOnEmpty`, `leaveOnFinish` | removed; `distube.on("queue.finished", ({ guildId }) => distube.voices.leave(guildId))`                                               |
| `distube.play(vc, song, { member, textChannel, message })`        | `await distube.play(vc, input, { metadata: { requestedBy: member.id } })`                                                             |
| `queue.songs[0]`                                                  | `queue.current?.song`                                                                                                                 |
| `queue.songs.slice(1)`                                            | `queue.upcoming.map(item => item.song)`                                                                                               |
| `queue.previousSongs`                                             | `queue.history.map(item => item.song)`                                                                                                |
| `queue.jump(2)`, `queue.previous()`, `queue.shuffle()`            | `await queue.jump(2)`, `await queue.previous()`, `queue.shuffle()`                                                                    |
| `queue.songs.splice(index, 1)`                                    | `queue.remove(index)` or `queue.remove({ from: 2, to: 4 })`                                                                           |
| `queue.addRelatedSong()`                                          | no v6 method; `queue.setAutoplay(true)`, or call the plugin's `related(song, { signal, exclude })` and pass the result to `queue.add` |
| `queue.pause()`, `queue.resume()`                                 | unchanged: `await queue.pause()`, `await queue.resume()`; a pause ends with its item, so the next item starts unpaused                |
| `queue.seek(seconds)`, `queue.stop()`                             | unchanged; `stop()` deletes the queue and keeps the voice                                                                             |
| `distube.play(vc, song, { position: 1 })`                         | `await queue.add(input, { next: true })` or `{ at: 0 }`                                                                               |
| `queue.filters.add("bassboost")`, `.remove(name)`, `.clear()`     | `await voice.filters.set("bassboost", 15)`, `.remove(name)`, `.clear()`                                                               |
| the `reverse` filter                                              | removed                                                                                                                               |
| `queue.setVolume(50)`, `queue.volume`                             | `await voice.setVolume(50)`, `voice.volume`; 0 to 1000, and the built-in engine clips above 100                                       |
| `queue.setRepeatMode(RepeatMode.SONG)`, `queue.repeatMode`        | `queue.setRepeat("song")`, `queue.repeat`                                                                                             |
| `queue.toggleAutoplay()`                                          | `queue.setAutoplay(!queue.autoplay)`                                                                                                  |
| `queue.currentTime`                                               | `queue.position`                                                                                                                      |
| `queue.paused`, `queue.playing`                                   | `queue.paused` unchanged, `queue.status === "playing"`                                                                                |
| `song.views`, `song.uploader.name`, `song.isLive`                 | `song.pluginData.views`, `.uploader`, `.live`, typed after `distube.search(q, { source: youtube })`                                   |
| `distube.search(query, { limit, type })`                          | `await distube.search(query, { source: youtube, limit })`                                                                             |
| `Events.PLAY_SONG`, `ADD_SONG`, `FINISH`, `ERROR`                 | `"queue.item.started"`, `"queue.item.added"`, `"queue.finished"`, `"queue.item.failed"` plus a `catch` on `play`                      |
| `on`, `once`, `off`, `removeAllListeners`                         | `const off = distube.on(name, listener)`; call `off()`                                                                                |
| `queue.textChannel`                                               | your own `Map` keyed by `queue.guildId`                                                                                               |
| `error.errorCode === "SPOTIFY_NOT_FOUND"`                         | `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and `error.source === "spotify"`                                                        |
| `shutdown()`                                                      | `await distube.dispose()`                                                                                                             |
| runtime `RepeatMode` and `Filters` enums                          | literals such as `"song"` and `"bassboost"`                                                                                           |

New in v6:

- Sound clips are Songs. Write a plugin with only a `stream` method, build a `Song` with its `source`, and call
  `await distube.play(channel, clip, { next: true })` or `await queue.add(clip, { next: true })`. See
  [clips](../direct-inputs/).
- A pause ends with its item. To keep music paused across items, call `queue.pause()` again in a
  `queue.item.started` listener.
- `idleTimeoutMs` (default 300000) makes a voice with no queue leave with `voice.disconnected` reason
  `idle`. Set `0` for a 24/7 bot, and handle `idle` in exhaustive switches.
- `await distube.suggest(query, { source, signal })` for autocomplete.
- `maxPlaylistSongs` (default 500) caps a Playlist resolved from a URL in core and in each official plugin. A Playlist passed directly is not cut.
- `DisTube` options `historySize` (default 10), `filters`, `connectionTimeoutMs`, `onDiagnostic` and
  `engine: { opusComplexity, bufferMs }`. See the [guide](../guide/#options). Built-in filter definitions, the
  connection timeout and engine settings are `DisTube` options, not adapter constructor options.
- `voice.track.*` events do not exist. Listen to `queue.item.started` and `queue.item.finished`.

`add`, `play`, `pause`, `resume`, `seek`, `skip`, `jump`, `previous` and `stop` return promises. `remove`, `move`,
`shuffle`, `clear`, `setRepeat` and `setAutoplay` edit synchronously. Insertion `at` is zero-based. Numeric `jump` and
`remove` positions are one-based. Volume, filters, self-deaf and self-mute stay on the voice when a queue
ends, and a queue that ends cleanly keeps the voice connected.

## Error codes

v6 has one `ErrorCode` list: `INVALID_ARGUMENT`, `INVALID_STATE`, `ABORTED`, `NO_RESULT`, `NOT_FOUND`,
`UNAVAILABLE`, `RATE_LIMITED`, `SOURCE_FAILED`, `VOICE_FAILED` and `UNSUPPORTED`. The per-plugin code objects
`YouTubeErrorCode`, `SoundCloudErrorCode`, `SpotifyErrorCode` and `LavalinkErrorCode` are gone. Check
`DisTubeError.is(error, ErrorCode.NOT_FOUND)` and read `error.source` for the plugin. YouTube's age restriction is
`UNAVAILABLE`. `PLUGIN_FAILED` and `QUEUE_FAILED` are gone too.

## Official plugins

Install `@distube/ytdl-core` `^5.0.1` next to `@distube/youtube`; it is a peer dependency.

| v5                                                                                                 | v6                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `new YouTubePlugin({ cookies, ytdlOptions })`                                                      | `new YouTubePlugin({ ytdl: new Ytdl({ cookie }) })`, with the cookie header string    |
| `YouTubeSong`, `YouTubePlaylist`, `YouTubeRelatedSong`, `YouTubeSearchResult*`, `SearchResultType` | `Song` and `Playlist` with `pluginData` typed `YouTubeData` and `YouTubePlaylistData` |
| `new SpotifyPlugin({ api: { ...credentials, topTracksCountry } })`                                 | `new SpotifyPlugin()`; credentials and `topTracksCountry` are removed                 |

The `ytdl` instance's cookie, PO token provider, `fetch` and client order apply to every YouTube search, lookup,
related, suggestion and playback request. YouTube tracks seek and change volume and filters mid-track on the
official local engines; live videos cannot seek. A `YtdlError` becomes `NOT_FOUND`, `UNAVAILABLE`, `RATE_LIMITED`
or otherwise `SOURCE_FAILED`, with the `YtdlError` as `cause`. A playlist or album with no playable track rejects
with `NO_RESULT`. Spotify is anonymous only and plays as in v5: core searches the other plugins top to bottom and plays the first
candidate. If none can, the item fails `NO_RESULT`, or `SOURCE_FAILED` when a search or stream failed. List YouTube or SoundCloud with Spotify, or use Lavalink. Without an engine plugin, `new DisTube` throws `INVALID_ARGUMENT` when no other plugin has `search` and `stream`. Lavalink loads a Song natively, then falls back to a name and artist search. `@distube/lavalink` is new in v6.

## Plugin authors

| Before                                               | v6                                                                                              |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `SourcePlugin`                                       | `Plugin`                                                                                        |
| `initialize(context)` and `PluginContext.diagnostic` | removed; validate options in the constructor                                                    |
| `preparePlayback`, `stream(song, context)`           | `stream(song, { signal })`                                                                      |
| `stream` returning a resource wrapper                | `stream` returns the `PlaybackResource`; omit `stream` to use the search fallback               |
| `resolve(url, options)`                              | `resolve(url, { signal, maxPlaylistSongs })`; stop paging at the cap and return the first Songs |
| `sources: []` in `DisTube` options                   | `plugins: []`                                                                                   |
| a plugin's own error code object                     | `DisTubeError` with a core code and `source: this.name`                                         |
| `@distube/plugin-network`                            | removed; each plugin owns its HTTP policy                                                       |
| `engine` option next to `sources`                    | a plugin with an `engine` member, in `plugins`                                                  |

## Adapter and engine authors

| Before                                               | v6                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `adapter.engine`                                     | `adapter.createEngine(settings)`                                                        |
| `VoiceSession.setSelfDeaf`, `setSelfMute`            | `VoiceSession.setSelfState({ selfDeaf, selfMute })`, flags only                         |
| no bitrate                                           | `VoiceSession.bitrate`, the channel bitrate in bits per second                          |
| none                                                 | `voiceClosed(code)`, `rejoin()` and `VoiceSessionOptions.signal`                        |
| `createPlayer(session)`                              | `createPlayer(session, { onClosed })`; call it once on a self-close, never on `release` |
| `Engine.accepts`, `capabilities`, `supportsResource` | removed; reject what you cannot play with `UNSUPPORTED`                                 |
| `Player.play({ itemId, resource })` plus `subscribe` | `Player.play(resource, { signal, onStart }) -> Promise<TrackEnd>`                       |
| `PlayerEvent`, `terminal` outcomes                   | removed; a rejected `play` is a failure                                                 |

`Player.play` replaces any current track, which settles `replaced` first, and starts unpaused. See
[adapter authoring](../adapter-authoring/) and [plugin authoring](../plugin-authoring/).

The built-in engine joins the native voice connection in a group named after the client user ID. Code that called
`getVoiceConnection(guildId)` from `@discordjs/voice` on that connection now calls
`getVoiceConnection(guildId, clientUserId)`.
