---
title: Migration
description: Move from DisTube v5 to v6, and update plugins, adapters and engines.
sidebar:
  order: 10
---

v6 removes aliases for the APIs it replaces. A music command starts with
`const queue = await distube.play(voiceChannel, input)`. `DisTubeQueue` schedules `current`, `upcoming`, `history`,
`repeat` and `autoplay`. `queue.voice` is the `DisTubeVoice` that owns the connection, volume, bitrate, filters,
self-deaf and self-mute.

## Applications

| v5                                                                | v6                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `new DisTube(client, { plugins: [new YouTubePlugin()] })`         | `new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [new YouTubePlugin()] })`                         |
| `@distube/eris`                                                   | removed; use `@distube/discordjs` or `@distube/oceanic`                                                          |
| `ytdlOptions`, `emitNewSongOnly`, `leaveOnEmpty`, `leaveOnFinish` | removed; `distube.on("queue.finished", ({ guildId }) => distube.voices.leave(guildId))`                          |
| `distube.play(vc, song, { member, textChannel, message })`        | `await distube.play(vc, input, { metadata: { requestedBy: member.id } })`                                        |
| `queue.songs[0]`                                                  | `queue.current?.song`                                                                                            |
| `queue.songs.slice(1)`                                            | `queue.upcoming.map(item => item.song)`                                                                          |
| `queue.previousSongs`                                             | `queue.history.map(item => item.song)`                                                                           |
| `queue.jump(2)`, `queue.previous()`, `queue.shuffle()`            | `await queue.jump(2)`, `await queue.previous()`, `await queue.shuffle()`                                         |
| `queue.songs.splice(index, 1)`                                    | `await queue.remove(index)` or `await queue.remove({ from: 2, to: 4 })`                                          |
| `queue.addRelatedSong()`                                          | `await queue.addRelated()`                                                                                       |
| `distube.play(vc, song, { position: 1 })`                         | `await queue.add(input, { next: true })` or `{ at: 0 }`                                                          |
| `queue.filters.add("bassboost")`, `.remove(name)`, `.clear()`     | `await voice.filters.set("bassboost", 15)`, `.remove(name)`, `.clear()`                                          |
| the `reverse` filter                                              | removed                                                                                                          |
| `queue.setVolume(50)`, `queue.volume`                             | `await voice.setVolume(50)`, `voice.volume`                                                                      |
| `queue.setRepeatMode(RepeatMode.SONG)`, `queue.repeatMode`        | `await queue.setRepeat("song")`, `queue.repeat`                                                                  |
| `queue.toggleAutoplay()`                                          | `await queue.setAutoplay(!queue.autoplay)`                                                                       |
| `queue.currentTime`                                               | `queue.position`                                                                                                 |
| `queue.paused`, `queue.playing`                                   | `queue.status === "paused"`, `queue.status === "playing"`                                                        |
| `song.views`, `song.uploader.name`, `song.isLive`                 | `song.pluginData.views`, `.uploader`, `.live`, typed after `distube.search(q, { source: youtube })`              |
| `distube.search(query, { limit, type })`                          | `await distube.search(query, { source: youtube, limit })`                                                        |
| `Events.PLAY_SONG`, `ADD_SONG`, `FINISH`, `ERROR`                 | `"queue.item.started"`, `"queue.item.added"`, `"queue.finished"`, `"queue.item.failed"` plus a `catch` on `play` |
| `on`, `once`, `off`, `removeAllListeners`                         | `const off = distube.on(name, listener)`; call `off()`                                                           |
| `queue.textChannel`                                               | your own `Map` keyed by `queue.guildId`                                                                          |
| `error.errorCode === "SPOTIFY_NOT_FOUND"`                         | `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and `error.source === "spotify"`                                   |
| `shutdown()`                                                      | `await distube.dispose()`                                                                                        |
| runtime `RepeatMode` and `Filters` enums                          | literals such as `"song"` and `"bassboost"`                                                                      |

New in v6:

- `await voice.play(resource, { signal, onStart })` plays a file, URL or stream without a queue and resolves with
  `{ reason: "finished" | "stopped" | "replaced" }`. A new `voice.play` replaces the current track, and a queue it
  interrupts is deleted with `queue.deleted` reason `replaced`. Handle that reason if you also play directly.
- `voice.setBitrate(bps | "auto")`.
- `distube.getSuggestions(query, source?)` for autocomplete.
- `DisTube` options `historySize` (default 10), `filters`, `connectionTimeoutMs`, `onDiagnostic` and
  `engine: { opusComplexity, bufferMs }`. See the [guide](../guide/#options).
- `voice.track.*` events do not exist. Await `voice.play` instead.

Queue commands return promises that settle after the edit commits. Insertion `at` is zero-based. Numeric `jump` and
`remove` positions are one-based. Volume, bitrate, filters, self-deaf and self-mute stay on the voice when a queue
ends, and a queue that ends cleanly keeps the voice connected.

## Error codes

v6 has one `ErrorCode` list: `INVALID_ARGUMENT`, `INVALID_STATE`, `ABORTED`, `NO_RESULT`, `NOT_FOUND`,
`UNAVAILABLE`, `RATE_LIMITED`, `SOURCE_FAILED`, `VOICE_FAILED` and `UNSUPPORTED`. The per-plugin code objects
`YouTubeErrorCode`, `SoundCloudErrorCode`, `SpotifyErrorCode` and `LavalinkErrorCode` are gone. Check
`DisTubeError.is(error, ErrorCode.NOT_FOUND)` and read `error.source` for the plugin. YouTube's age restriction is
`UNAVAILABLE`. `PLUGIN_FAILED` and `QUEUE_FAILED` are gone too.

## Plugin authors

| Before                                               | v6                                                      |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `SourcePlugin`                                       | `Plugin`                                                |
| `initialize(context)` and `PluginContext.diagnostic` | removed; validate options in the constructor            |
| `preparePlayback`, `stream(song, context)`           | `stream(song, { signal })`                              |
| `sources: []` in `DisTube` options                   | `plugins: []`                                           |
| a plugin's own error code object                     | `DisTubeError` with a core code and `source: this.name` |
| `@distube/plugin-network`                            | removed; each plugin owns its HTTP policy               |
| `engine` option next to `sources`                    | a plugin with an `engine` member, in `plugins`          |

## Adapter and engine authors

| Before                                               | v6                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------- |
| `adapter.engine`                                     | `adapter.createEngine(settings)`                                  |
| `VoiceSession.setSelfDeaf`, `setSelfMute`            | `VoiceSession.join(channelId, { selfDeaf, selfMute })`            |
| no bitrate                                           | `VoiceSession.bitrate`, the channel bitrate in bits per second    |
| `Engine.accepts`, `capabilities`, `supportsResource` | removed; reject what you cannot play with `UNSUPPORTED`           |
| `Player.play({ itemId, resource })` plus `subscribe` | `Player.play(resource, { signal, onStart }) -> Promise<TrackEnd>` |
| `PlayerEvent`, `terminal` outcomes                   | removed; a rejected `play` is a failure                           |

`Player.play` replaces any current track, which settles `replaced` first. See
[adapter authoring](../adapter-authoring/) and [plugin authoring](../plugin-authoring/).
