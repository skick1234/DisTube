---
title: Updating from v5
description: Move a bot from DisTube v5 to v6, and update plugins, adapters and engines.
sidebar:
  order: 5
---

This page maps v5 calls to v6, and lists every v5 option, event and error code with its replacement. v6 keeps no
aliases for the APIs it replaces, so a v5 bot does not run unchanged. Work through the tables top to bottom.

Three changes touch almost every command:

- You create DisTube with an adapter: `new DisTube({ adapter: new DiscordJSAdapter(client), plugins })`.
- A music command starts with `const { queue, items } = await distube.play(voiceChannel, input)`.
- The queue and the voice are two objects. `DisTubeQueue` schedules `current`, `upcoming`, `history`, `repeat` and
  `autoplay`. `queue.voice` is the `DisTubeVoice` that owns the connection, volume, filters, self-deaf and self-mute.
  [How DisTube works](../how-distube-works/#queue-and-voice) explains the split.

## Your bot's code

Find the v5 call on the left and replace it with the v6 code on the right.

| v5                                                                             | v6                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `new DisTube(client, { plugins: [new YouTubePlugin()] })`                      | `new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [new YouTubePlugin()] })`                                              |
| `@distube/eris`                                                                | removed; use `@distube/discordjs` or `@distube/oceanic`                                                                               |
| `distube.play(vc, song, { member, textChannel, message })`                     | `await distube.play(vc, input, { metadata: { requestedBy: member.id } })`                                                             |
| `queue.songs[0]`                                                               | `queue.current?.song`                                                                                                                 |
| `queue.songs.slice(1)`                                                         | `queue.upcoming.map(item => item.song)`                                                                                               |
| `queue.previousSongs`                                                          | `queue.history.map(item => item.song)`                                                                                                |
| `queue.jump(2)`, `queue.previous()`, `queue.shuffle()`                         | `await queue.jump(2)`, `await queue.previous()`, `queue.shuffle()`                                                                    |
| `queue.songs.splice(index, 1)`                                                 | `queue.remove(index)` or `queue.remove({ from: 2, to: 4 })`                                                                           |
| `queue.addRelatedSong()`                                                       | no v6 method; `queue.setAutoplay(true)`, or call the plugin's `related(song, { signal, exclude })` and pass the result to `queue.add` |
| autoplay songs credited to `queue.clientMember`                                | `item.autoplay === true`; `item.metadata` is the metadata of the item it followed                                                     |
| `queue.pause()`, `queue.resume()`                                              | unchanged: `await queue.pause()`, `await queue.resume()`; a pause ends with its item, so the next item starts unpaused                |
| `queue.seek(seconds)`, `queue.stop()`                                          | unchanged; `stop()` deletes the queue and keeps the voice                                                                             |
| `distube.play(vc, song, { position: 1 })`                                      | `await queue.add(input, { next: true })` or `{ at: 0 }`                                                                               |
| `queue.filters.add("bassboost")`, `.remove(name)`, `.clear()`                  | `await voice.filters.set("bassboost", 15)`, `.remove(name)`, `.clear()`                                                               |
| the `reverse` filter                                                           | removed                                                                                                                               |
| `queue.setVolume(50)`, `queue.volume`                                          | `await voice.setVolume(50)`, `voice.volume`; 0 to 1000, and the built-in engine clips above 100                                       |
| `queue.setRepeatMode(RepeatMode.SONG)`, `queue.repeatMode`                     | `queue.setRepeat("song")`, `queue.repeat`                                                                                             |
| `queue.toggleAutoplay()`                                                       | `queue.setAutoplay(!queue.autoplay)`                                                                                                  |
| `queue.currentTime`                                                            | `queue.position`                                                                                                                      |
| `queue.paused`, `queue.playing`                                                | `queue.paused` unchanged, `queue.status === "playing"`; `"preparing"` covers an item that is not audible yet                          |
| `song.views`, `song.uploader.name`, `song.isLive`                              | `song.pluginData.views`, `.uploader`, `.live`, typed after `distube.search(q, { source: youtube })`                                   |
| `distube.search(query, { limit, type })`                                       | `await distube.search(query, { source: youtube, limit })`                                                                             |
| `Events.PLAY_SONG`, `ADD_SONG`, `FINISH`, `ERROR`                              | `"queue.item.started"`, `"queue.item.added"`, `"queue.finished"`, `"queue.item.failed"` plus a `catch` on `play`                      |
| `on`, `once`, `off`, `removeAllListeners`                                      | `const off = distube.on(name, listener)`; call `off()`                                                                                |
| `queue.textChannel`                                                            | your own `Map` keyed by `queue.guildId`                                                                                               |
| `error.errorCode === "SPOTIFY_NOT_FOUND"`                                      | `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and `error.source === "spotify"`                                                        |
| `song.stream.song`, the Song a Spotify track played through                    | `event.fallback` on `"queue.item.started"`                                                                                            |
| `song.playlist`, the Playlist a Song was added from                            | `item.playlist`, kept by repeat and `queue.previous()`, absent on autoplay items                                                      |
| walking `error.cause` for a `YtdlError` with code `BOT_CHECK` or `NOT_STARTED` | `DisTubeError.is(error, ErrorCode.BOT_CHECK)` and `DisTubeError.is(error, ErrorCode.NOT_STARTED)`                                     |
| the query parsed out of `Cannot find "<query>"`                                | `error.query` on the error core raises after asking every plugin                                                                      |
| playlist-specific messages such as `Unknown Playlist`                          | `error.media === "playlist"` on `NOT_FOUND`, `UNAVAILABLE` or `NO_RESULT`                                                             |
| `shutdown()`                                                                   | `await distube.dispose()`                                                                                                             |
| runtime `RepeatMode` and `Filters` enums                                       | literals such as `"song"` and `"bassboost"`                                                                                           |

## New in v6

- Sound clips are Songs. Write a plugin with only a `stream` method, build a `Song` with its `source`, and call
  `await distube.play(channel, clip, { next: true })` or `await queue.add(clip, { next: true })`. See
  [sound clips](../../popular-topics/soundboard/).
- A pause ends with its item. To keep music paused across items, call `queue.pause()` again in a
  `queue.item.started` listener.
- DisTube never leaves voice on its own. To leave after the queue ends or when the channel empties, add the
  listeners from [leave voice](../../guides/leave-when-empty/#leave-when-the-channel-is-empty).
- `await distube.suggest(query, { source, signal })` returns completions for autocomplete.
- `distube.play` resolves `{ queue, items }`. `items` are the occurrences that call added, so a command can reply
  with them. `await queue.skip()` resolves the item that plays next, or `undefined`.
- `queue.updated` fires after every committed change to the queue, its pause or a seek, and after a change to
  its voice's volume or filters. One listener keeps a status message current. See
  [now playing](../../guides/now-playing/).
- `distube.filters` lists the engine's presets without a voice. `queue.playbackRate` is the speed of the selected
  filters. See [volume and filters](../../guides/volume-and-filters/).
- `onDiagnostic` also receives the built-in engine's `engine.*` stages. See
  [options](../../reference/options/#diagnostics).
- `maxPlaylistSongs` (default 500) caps a Playlist resolved from a URL, in core and in each official plugin. DisTube
  does not cut a Playlist you pass in directly.
- New `DisTube` options: `historySize` (default 10), `filters`, `connectionTimeoutMs`, `onDiagnostic` and
  `engine: { opusComplexity, bufferMs }`. See [options](../../reference/options/). Built-in filter definitions, the
  connection timeout and engine settings are `DisTube` options, not adapter constructor options.
- There are no `voice.track.*` events. Listen to `queue.item.started` and `queue.item.finished`.

A few rules hold across the whole API:

- `add`, `play`, `pause`, `resume`, `seek`, `skip`, `jump`, `previous` and `stop` return promises.
- `remove`, `move`, `shuffle`, `clear`, `setRepeat` and `setAutoplay` change the queue synchronously.
- Insertion `at` counts from zero. Numeric `jump` and `remove` positions count from one.
- Volume, filters, self-deaf and self-mute stay on the voice when a queue ends. A queue that ends cleanly keeps the
  voice connected.

## Options

This table covers every `DisTubeOptions` field in v5.2.3. The [options reference](../../reference/options/) lists the
v6 constructor options.

| v5                             | v6                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `plugins`                      | `plugins`, now required, with an `adapter`; sources and the engine share the array                                             |
| `emitNewSongOnly`              | removed; `queue.item.started` fires for every occurrence, so compare `event.item.song` with the last one in your listener      |
| `savePreviousSongs`            | `historySize` (default 10); `0` disables history                                                                               |
| `customFilters`                | `filters`                                                                                                                      |
| `nsfw`                         | `allowAgeRestricted` on each `play`, `queue.add` and `search` call, so a guild setting decides it; default `false`             |
| `emitAddSongWhenCreatingQueue` | removed; `queue.item.added` always fires, and `queue.created` fires first for a new queue                                      |
| `emitAddListWhenCreatingQueue` | removed; `queue.playlist.added` always fires                                                                                   |
| `joinNewVoiceChannel`          | removed; `play(channel, input)` always joins that channel, or moves the guild's voice there                                    |
| `ffmpeg.path`, `ffmpeg.args`   | removed; the built-in engine decodes with `node-av`, not an ffmpeg binary. Tune it with `engine: { opusComplexity, bufferMs }` |

## Events

This table covers every v5 event. The [events reference](../../reference/events/) lists the v6 payloads.

| v5 `Events`   | v6                                                                                                                               |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `initQueue`   | `queue.created`                                                                                                                  |
| `addSong`     | `queue.item.added`                                                                                                               |
| `addList`     | `queue.playlist.added`                                                                                                           |
| `playSong`    | `queue.item.started`                                                                                                             |
| `finishSong`  | `queue.item.finished`; a skipped item publishes none                                                                             |
| `finish`      | `queue.finished`                                                                                                                 |
| `deleteQueue` | `queue.deleted`, with a `reason`                                                                                                 |
| `disconnect`  | `voice.disconnected`, with a `reason`                                                                                            |
| `error`       | `queue.item.failed` for playback, and a rejected `play` or `add` for the command                                                 |
| `noRelated`   | `queue.autoplay.failed`                                                                                                          |
| `empty`       | none; watch voice state updates yourself, see [leave when empty](../../guides/leave-when-empty/#leave-when-the-channel-is-empty) |
| `ffmpegDebug` | removed; there is no ffmpeg process                                                                                              |
| `debug`       | the `onDiagnostic` option                                                                                                        |

## Behaviour changes

- The default volume is 100, not 50, and the scale is linear. v5 raised the percentage to a power, and v6 multiplies
  the samples by `volume / 100`. A bot that relied on 50 calls `voice.setVolume(50)`.
- `distube.getQueue(guildId)` takes a guild ID string, not a guild resolvable.
- `jump`, `previous`, `pause`, `resume` and `seek` resolve with `void`. v5 resolved with a Song or the queue. Read
  `queue.current` afterwards. `skip` resolves the item that plays next, or `undefined` when nothing waits, and does not
  wait for that item to start.
- `play` resolves `{ queue, items }`, not the queue. Replace `const queue = await distube.play(...)` with
  `const { queue, items } = await distube.play(...)`.
- `queue.status` has a fourth value, `preparing`. It covers an item that waits, an autoplay lookup in progress, and
  an item the player has but is not playing out loud yet. `playing` now means audible. Handle `preparing` in an
  exhaustive `switch`.
- `jump` takes a positive number or an item ID. `jump(-1)` rejects `INVALID_ARGUMENT`, so call `queue.previous()`.
- `skip()` on the last item ends the queue and publishes `queue.finished`. v5 threw `NO_UP_NEXT` unless autoplay found
  a related Song.
- `play` and `add` take typed `metadata`, which replaces `member`, `textChannel` and `message`. Declare its type once
  as the first type parameter, `new DisTube<RequestMetadata>(...)`, and every `QueueItem` carries it.
- A provider data error that v5 surfaced as its own code now rejects `SOURCE_FAILED`. Read `error.cause` for the
  original.
- `distube.on` throws `INVALID_ARGUMENT` for a name that is not in the events table, when you register it.
- The deezer, bandlab, direct-link and file plugins are retired. For an audio URL or an uploaded file, write a
  plugin with `resolve` and `stream`, as in [direct links](../../popular-topics/direct-links/).
- `@distube/yt-dlp` is back, but `YtDlpPlugin({ update })` becomes `YtDlpPlugin({ binary })`. The `update` option, the
  `YTDLP_*` environment variables and the postinstall download are gone, and so are the `json` and `download` exports.
  It has no search or related songs. See [yt-dlp](../../plugins/yt-dlp/).
- The cookie array of `YouTubePlugin` is now one header string on a `Ytdl` instance. See
  [official plugins](#official-plugins).

## Error codes

v6 has one `ErrorCode` list: `INVALID_ARGUMENT`, `INVALID_STATE`, `ABORTED`, `NO_RESULT`, `NOT_FOUND`,
`UNAVAILABLE`, `RATE_LIMITED`, `BOT_CHECK`, `NOT_STARTED`, `SOURCE_FAILED`, `VOICE_FAILED`, `VOICE_DISCONNECTED`,
`UNSUPPORTED` and `AGE_RESTRICTED`.

The per-plugin code objects `YouTubeErrorCode`, `SoundCloudErrorCode`, `SpotifyErrorCode` and `LavalinkErrorCode`
are gone, and so are `PLUGIN_FAILED` and `QUEUE_FAILED`. Check `DisTubeError.is(error, ErrorCode.NOT_FOUND)` and read
`error.source` for the plugin.

A few codes name cases v5 lumped together:

- `AGE_RESTRICTED`: YouTube refused an age-restricted video without a signed-in account.
- `BOT_CHECK`: the provider refuses the client until it proves it is not a bot, such as YouTube's "Sign in to
  confirm you're not a bot".
- `NOT_STARTED`: scheduled media that has not started yet, such as a premiere.

When every plugin fails with the same code, the exhaustion error carries that code. When every failure came from
one service, it carries that service's `source` too. So `RATE_LIMITED` no longer hides inside `SOURCE_FAILED`. The `AggregateError`
stays in `cause`.

Stop parsing error messages. `error.query` holds the text that found nothing, and `error.media` says whether a failed
lookup was for a `"song"` or a `"playlist"`.

Every v5 code and where it went:

| v5 code                                                                                                                                 | v6                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_TYPE`, `NUMBER_COMPARE`, `EMPTY_ARRAY`, `EMPTY_FILTERED_ARRAY`, `EMPTY_STRING`, `INVALID_KEY`, `MISSING_KEY`, `MISSING_KEYS`   | `INVALID_ARGUMENT`                                                                                                                             |
| `DISABLED_OPTION`, `ENABLED_OPTION`                                                                                                     | `INVALID_ARGUMENT` for a bad option, `INVALID_STATE` for a valid call that is not allowed now                                                  |
| `MISSING_INTENTS`                                                                                                                       | none; the adapter's library owns its intents                                                                                                   |
| `NOT_IN_VOICE`                                                                                                                          | `INVALID_ARGUMENT`; `play` needs a voice channel, so check the member first                                                                    |
| `VOICE_FULL`, `VOICE_MISSING_PERMS`, `VOICE_CONNECT_FAILED`, `VOICE_ALREADY_CREATED`, `VOICE_DIFFERENT_GUILD`, `VOICE_DIFFERENT_CLIENT` | `VOICE_FAILED`, with the adapter's error as `cause`; moving a voice to another guild is `INVALID_ARGUMENT`                                     |
| `VOICE_RECONNECT_FAILED`                                                                                                                | `voice.disconnected` with reason `platform` and a `VOICE_DISCONNECTED` error; a member disconnecting the bot is reason `removed` with no error |
| `FFMPEG_EXITED`, `FFMPEG_NOT_INSTALLED`, `ENCRYPTION_LIBRARIES_MISSING`                                                                 | `VOICE_FAILED`; a host that cannot load `node-av` fails the first playback with it                                                             |
| `NO_QUEUE`, `QUEUE_STOPPED`                                                                                                             | `getQueue` returns `undefined`; a call on a deleted queue rejects `INVALID_STATE`                                                              |
| `QUEUE_EXIST`, `PAUSED`, `RESUMED`                                                                                                      | none; `play` adds to the existing queue, and `pause` and `resume` twice are harmless                                                           |
| `NO_PREVIOUS`, `NO_SONG_POSITION`, `NO_PLAYING_SONG`                                                                                    | `INVALID_STATE`                                                                                                                                |
| `NO_UP_NEXT`                                                                                                                            | none; `skip()` ends the queue                                                                                                                  |
| `NO_EXTRACTOR_PLUGIN`                                                                                                                   | `INVALID_ARGUMENT` from `new DisTube` when no plugin can play                                                                                  |
| `NO_RELATED`, `CANNOT_PLAY_RELATED`                                                                                                     | `queue.autoplay.failed` with `SOURCE_FAILED`                                                                                                   |
| `UNAVAILABLE_VIDEO`, `UNPLAYABLE_FORMATS`                                                                                               | `UNAVAILABLE`                                                                                                                                  |
| `NON_NSFW`                                                                                                                              | `AGE_RESTRICTED`                                                                                                                               |
| `NOT_SUPPORTED_URL`, `NO_RESULT`, `CANNOT_GET_SEARCH_QUERY`                                                                             | `NO_RESULT`, with `error.query`                                                                                                                |
| `NO_VALID_SONG`, `CANNOT_RESOLVE_SONG`                                                                                                  | `INVALID_ARGUMENT`                                                                                                                             |
| `NOT_SUPPORTED_SONG`, `CANNOT_GET_STREAM_URL`, `NO_STREAM_URL`                                                                          | `SOURCE_FAILED`                                                                                                                                |
| `EMPTY_PLAYLIST`, `EMPTY_FILTERED_PLAYLIST`                                                                                             | `NO_RESULT` with `error.media === "playlist"`                                                                                                  |

## Official plugins

`@distube/youtube` depends on `@distube/ytdl-core` `^5.2.0`. Install it yourself only to import `Ytdl`, as in the
rows below.

| v5                                                                                                 | v6                                                                                    |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `new YouTubePlugin({ cookies, ytdlOptions })`                                                      | `new YouTubePlugin({ ytdl: new Ytdl({ cookie }) })`, with the cookie header string    |
| `YouTubeSong`, `YouTubePlaylist`, `YouTubeRelatedSong`, `YouTubeSearchResult*`, `SearchResultType` | `Song` and `Playlist` with `pluginData` typed `YouTubeData` and `YouTubePlaylistData` |
| `new SpotifyPlugin({ api: { ...credentials, topTracksCountry } })`                                 | `new SpotifyPlugin()`; credentials and `topTracksCountry` are removed                 |
| `new SoundCloudPlugin({ clientId, oauthToken })`                                                   | `new SoundCloudPlugin({ clientIdV2: clientId, oauthTokenV2: oauthToken })`            |

The `ytdl` instance's cookie, PO token provider, `fetch` and client order apply to every YouTube search, lookup,
related, suggestion and playback request.

YouTube tracks seek and change volume and filters mid-track on the official local engines. Live videos cannot seek.

A `YtdlError` becomes `NOT_FOUND`, `UNAVAILABLE`, `RATE_LIMITED`, `BOT_CHECK`, `NOT_STARTED`, `AGE_RESTRICTED` or
otherwise `SOURCE_FAILED`, with the `YtdlError` as `cause`. A playlist or album with no playable track rejects with
`NO_RESULT`.

SoundCloud's `clientId` now means an official app ID and needs `clientSecret`. Passing a web client ID alone throws
`INVALID_ARGUMENT`; use `clientIdV2` instead. Preview-only tracks, such as Go+ snippets, now reject `UNAVAILABLE` rather
than playing a snippet. Search, related tracks and playlists leave them out. See [SoundCloud](../../plugins/soundcloud/).

Spotify is anonymous only and plays as in v5. Core searches the other plugins top to bottom and plays the first
candidate. If none can, the item fails `NO_RESULT`. If some failed, it fails with the code every failure shares, such
as `RATE_LIMITED`, or `SOURCE_FAILED` when they differ. See
[when every plugin failed](../../reference/errors/#when-every-plugin-failed).

:::caution
Spotify cannot stream, so list YouTube or SoundCloud with it, or use Lavalink. Without an engine plugin that prepares
Songs, such as Lavalink, `new DisTube` throws `INVALID_ARGUMENT` when no other plugin has `search` and `stream`.
:::

`@distube/lavalink` is new in v6. It loads a Song natively, then falls back to a name and artist search.

## Plugin authors

| v5                                                                                        | v6                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `ExtractorPlugin`, `InfoExtractorPlugin`, `PlayableExtractorPlugin` classes with a `type` | one `Plugin` object with a `name` and the members it needs                                                           |
| `init(distube)` and the `distube` field                                                   | removed; validate options in the constructor                                                                         |
| `validate(url)` plus `resolve(url, options)`                                              | `resolve(url, { signal, maxPlaylistSongs })`, returning `undefined` to decline; stop paging at the cap               |
| `searchSong(query, options)`                                                              | `search(query, { signal, limit, offset })`, returning Songs                                                          |
| `getStreamURL(song)`                                                                      | `stream(song, { signal })`, returning a `PlaybackResource`                                                           |
| `createSearchQuery(song)` on an `InfoExtractorPlugin`                                     | omit `stream`; core searches the other plugins by the Song's name and artist                                         |
| `getRelatedSongs(song)`                                                                   | `related(song, { signal, exclude })`, returning one Song or `undefined`                                              |
| a plugin's own error code object                                                          | `DisTubeError` with a core code and `source: this.name`; `BOT_CHECK` and `NOT_STARTED` exist for walls and premieres |

## Adapter and engine authors

v5 had no adapter or engine contracts, so there is nothing to port. Start from
[adapter authoring](../../extending/adapter-authoring/) and [plugin authoring](../../extending/plugin-authoring/).

The built-in engine joins the native voice connection in a group named after the client user ID. Code that called
`getVoiceConnection(guildId)` from `@discordjs/voice` on that connection now calls
`getVoiceConnection(guildId, clientUserId)`.
