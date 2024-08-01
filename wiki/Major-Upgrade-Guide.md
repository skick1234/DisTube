# Updating from v4 to v5

## DisTube

DisTube doesn't support any music sources anymore. You have to use plugins to support them.

### DisTubeOptions

Removed `streamType`, `youtubeCookie`, `ytdlOptions`, `searchSongs`, `directLink`, `leaveOnStop`, `leaveOnEmpty` and `leaveOnFinish` options.

- `leaveOnEmpty`: Check [Handling Discord.js Events](https://github.com/skick1234/DisTube/wiki/Handling-Discord.js-Events)
- `leaveOnStop`: Add `queue.voice.leave()` after `queue.stop()` line
- `leaveOnFinish`: Add `queue.voice.leave()` in the `finish` event
- `directLink`: Use `@distube/direct-link` plugin
- `youtubeCookie` and `ytdlOptions`: Check the `@distube/youtube` plugin options

### DisTube#search

DisTube#search was removed since it doesn't support YouTube anymore, you can use `YouTubePlugin#search` or `SoundCloudPlugin#search`,... instead.\
Please check the plugin docs for more information.

```ts
import { YouTubePlugin } from "@distube/youtube"
import { DisTube } from "distube"

const ytPlugin = new YouTubePlugin(...);
const distube = new DisTube({
    plugins: [ytPlugin],
    ...
})

ytPlugin.search(query, { type: "video", limit: 5, safeSearch: true }).then(console.log)
```

### Error event

- `error` event arguments changed. Check the API docs for details.

```diff
- distube.on('error', (channel, e) => {
-   if (channel) channel.send(`An error encountered: ${e}`)
-   else console.error(e)
-})
+ distube.on('error', (e, queue, song) => {
+   queue.textChannel.send(`An error encountered: ${e}`);
+ })
```

## Song

- Use `Song#stream` in favor of `Song#streamURL`
- Rename `Song#age_restricted` to `Song#ageRestricted`
- Remove `Song#chapters`

```diff
- const ageRestricted = song.age_restricted
+ const ageRestricted = song.ageRestricted
- const duration = song.duration
+ const duration = song.stream.playFromSource ? song.duration : song.stream.song.duration
- const streamURL = song.streamURL
+ const streamURL = song.stream.playFromSource ? song.stream.url : song.stream.song.stream.url
```

On v5, `Song` info is not represented the `Song` will be streamed to the voice channel if `Song#playFromSource` is `false`

Example: `s` is a Spotify `Song`, `s.source` is `spotify`, `s.playFromSource` is `false`. When the song plays, `s.stream.song` will be a stream-able `Song` searched with an `ExtractorPlugin`. And DisTube will play the `s.stream.song` instead of `s`

Note: `Song#stream.url` or `Song#stream.song` is only available when the song is playing.

# Updating from v3 to v4

## Before you start

v4 requires discord.js v14 to use, so make sure you're up to date. To update your discord.js code, check [their guide](https://discordjs.guide/) before updating DisTube code.
Also, update plugins if you're using them.

## DisTube

### DisTubeOptions

The built-in `youtube-dl` plugin is removed for more convenient updating in the future. Now, you can use the new [`@distube/yt-dlp` plugin](https://www.npmjs.com/package/@distube/yt-dlp).

```diff
- const distube = new DisTube({ youtubeDL: true, updateYouTubeDL: false })
+ const { YtDlpPlugin } = require("@distube/yt-dlp")
+ const distube = new DisTube({ plugins: [new YtDlpPlugin({ update: false })] })
```

### DisTube#play

- `DisTube#play` no longer supports `Message` as its parameter, requiring `BaseGuildVoiceChannel` instead (same as v3 `DisTube#playVoiceChannel`). This also has an `options` parameter for providing optional arguments.

```diff
- distube.play(message, ...)
+ distube.play(message.member.voice.channel, ..., { message, member: message.member })
```

- `options.position` has been added for customize added song/playlist position. That why `options.unshift` no longer exists on this version.

```diff
- distube.play(..., { unshift: true })
+ distube.play(..., { position: 1 })
```

- Now this method throw an error if DisTube cannot play the input song instead of emitting to the `error` event.

```js
distube.play().catch(err => {
  message.reply(err);
});
// Or
async function play() {
  try {
    await distube.play();
  } catch (err) {
    message.reply(err);
  }
}
```

### DisTube#playVoiceChannel

This method has been removed and replaced with `DisTube#play`.

```diff
- distube.playVoiceChannel(...)
+ distube.play(...)
```

### DisTube#playCustomPlaylist

`DisTube#playCustomPlaylist` has been removed. You can use `DisTube#createCustomPlaylist` and `DisTube#play` instead.

```diff
const songs = ["https://www.youtube.com/watch?v=xxx", "https://www.youtube.com/watch?v=yyy"];
- distube.playCustomPlaylist(message, songs, { name: "My playlist name" });
+ const playlist = await distube.createCustomPlaylist(songs, {
+     member: message.member,
+     properties: { name: "My playlist name" },
+     parallel: true
+ });
+ distube.play(message.member.voice.channel, playlist);
```

## Queue

### Queue#setFilter

- `Queue#setFilter` has been removed. You can use `Queue#filters` instead.

### Queue#filters

- `Queue#filters` is now `FilterManager`, which is more flexible and support custom filters.

```js
queue.filters.add("a-filter");
// filters: ["a-filter"]
queue.filters.add(["another-filter", "a-third-filter"]);
// filters: ["a-filter", "another-filter", "a-third-filter"]
queue.filters.add(["a-third-filter"]);
// filters: ["a-filter", "another-filter", "a-third-filter"]
queue.filters.remove(["a-filter", "a-third-filter"]);
// filters: ["another-filter"]
queue.filters.set(["1", "2", "3"]);
// filters: ["1", "2", "3"]
queue.filters.clear();
// filters: []
```

# Updating from v2 to v3

## Requirement

DisTube v3 is built on `@discordjs/voice`. That why we need to install [@discordjs/voice](https://github.com/discordjs/voice) and [sodium](https://www.npmjs.com/package/sodium) or [libsodium-wrappers](https://www.npmjs.com/package/libsodium-wrappers)

```sh
npm i @discordjs/voice sodium
```

## DisTube class

### Constructor

v3 is written in TypeScript, so we need to change how to create the DisTube instance.

```diff
const DisTube = require("distube")
- const distube = new DisTube(options)
+ const distube = new DisTube.default(options) // or new DisTube.DisTube(options)
```

or

```diff
- const DisTube = require("distube")
+ const { DisTube } = require("distube")
const distube = new DisTube(options)
```

## DisTube Events

### Changes

v3 doesn't emit `Message` parameter anymore. 100% events are changed. You can check the documentation for details.

```diff
- .on("playSong", (message, queue, song) => {
-   message.channel.send(...)
- })
+ .on("playSong", (queue, song) => {
+   queue.textChannel.send(...)
+ })

- .on("error", (message, err) => {
-   message.channel.send(...)
- })
+ .on("error", (channel, error) => {
+   channel.send();
+ })
```

#### playList event

`playList` event was removed, you can use `playSong` instead.

```diff
- .on("playList", ...)
.on("playSong", (queue, song) => {
-   // Your code when playing a song
+   if (song.playlist) {
+     // If the playing song is in a playlist
+   } else {
+     // Your code when playing a song
+   }
})
```

According to the above example, you will think it's make your code longer. But no, if you use the same template with your `playList` and `playSong` event, this will help you reduce some duplication code.

```js
distube.on("playSong", (queue, song) => {
  let msg = `Playing \`${song.name}\` - \`${song.formattedDuration}\``;
  if (song.playlist) msg = `Playlist: ${song.playlist.name}\n${msg}`;
  queue.textChannel.send(msg);
});
```

### Addition

New events on v3:

- [deleteQueue](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-deleteQueue)
- [disconnect](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-disconnect)
- [finishSong](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-finishSong)
- [searchDone](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-searchDone)
- [searchInvalidAnswer](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-searchInvalidAnswer)
- [searchNoResult](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=e-searchNoResult)

Click above links and read the docs for more information.

## DisTube Methods

### Changes

#### Removed methods

- `DisTube#playSkip` is removed in favor of `DisTube#play` with skip parameter
- `DisTube#runAutoplay` is removed in favor of `DisTube#addRelatedSong`
- `DisTube#isPlaying`, `DisTube#isPaused` is removed

#### DisTube#play

`skip` parameter becomes a property in `options` parameter. Add `unshift` property to `options`

```diff
- <DisTube>#playSkip(...)
- <DisTube>#play(..., true)
+ <DisTube>#play(..., { skip: true })
```

#### DisTube#playCustomPlaylist

`skip` parameter becomes a property in `options` parameter. Add `parallel` and `unshift` property to `options`

```diff
- <DisTube>#playCustomPlaylist(..., true)
+ <DisTube>#playCustomPlaylist(..., { skip: true })
```

#### DisTube#setFilter

`#setFilter` now supports applying multiple filters in a single Queue

```js
// No filter applied
distube.setFilter(message, "3d");
// Applied filters: 3d
distube.setFilter(message, ["3d", "bassboost", "vaporwave"]);
// Applied filters: bassboost, vaporwave
distube.setFilter(message, ["3d", "bassboost", "vaporwave"], true);
// Applied filters: 3d, bassboost, vaporwave
distube.setFilter(message, false);
// No filter applied
```

#### DisTube#search

Add `options` parameter to change limit, type and restricted mode of the results

```js
distube.search("A query", {
  limit: 10,
  type: "video",
  safeSearch: false,
});
```

### Addition

New methods on v3:

- [playVoiceChannel](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=playVoiceChannel)
- [addRelatedSong](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=addRelatedSong)
- [previous](https://distube.js.org/#/docs/DisTube/v3/class/DisTube?scrollTo=previous)

Click above links and read the docs for more information.

## Voice

### Voice Management

Because v3 is built on `@discordjs/voice`, you **MUST NOT** use built-in voice system on discord.js v12, or DisTube cannot work as expected. On discord.js v13, you can use `@discordjs/voice` functions to manage your voice functions but I highly recommend using `DisTubeVoiceManager` instead.

```diff
- <VoiceChannel>#join() // djs v12
- joinVoiceChannel(...) // @discordjs/voice
+ <DisTubeVoiceManager>#join(<VoiceChannel>)

- <VoiceChannel>#leave() // djs v12
- <VoiceConnection>#destroy() // @discordjs/voice
+ <DisTubeVoiceManager>#leave(<GuildIDResolvable>)
```

Example:

```diff
- message.member.voice.channel.join() // djs v12
- joinVoiceChannel(...) // @discordjs/voice
+ distube.voices.join(message.member.voice.channel)

- message.member.voice.channel.leave() // djs v12
- getVoiceConnection(...).destroy() // @discordjs/voice
+ distube.voices.leave(message)
```

### DisTubeVoice

`<DisTubeVoiceManager>.join()` returns `DisTubeVoice` to manage the voice connection instead of discord.js' `VoiceConnection`. `DisTubeVoice` is created to make you manage your voice easier and not to use complicated `@discordjs/voice` stuff.

```diff
- <VoiceChannel>#leave() // djs v12
- <VoiceConnection>#destroy() // @discordjs/voice
+ <DisTubeVoice>#leave()

- <VoiceState>#setSelfMute(boolean)
+ <DisTubeVoice>#setSelfMute(boolean)

- <VoiceState>#setSelfDeaf(boolean)
+ <DisTubeVoice>#setSelfDeaf(boolean)
```

Example:

```diff
- message.member.voice.channel.leave() // djs v12
- getVoiceConnection(...).destroy() // @discordjs/voice
+ distube.voices.get(message).leave()

- message.guild.me.voice.setSelfMute(true) // djs v12
- joinVoiceChannel({..., selfMute: true}) // @discordjs/voice
+ distube.voices.get(message).setSelfMute(true)

- message.guild.me.voice.setSelfDeaf(true) // djs v12
- joinVoiceChannel({..., selfDeaf: true}) // @discordjs/voice
+ distube.voices.get(message).setSelfDeaf(true)
```

## DisTubeOptions

### Changes

#### DisTubeOptions#searchSongs

`searchSongs` now require a `number` instead of `boolean`. `searchResults` event will emit the number of results based on this option.

```diff
- new DisTube({ searchSongs: true })
+ new DisTube({ searchSongs: 10 })

- new DisTube({ searchSongs: false })
+ new DisTube({ searchSongs: 0 }) // or searchSongs: 1
```

### Additions

New options on v3: `#plugins`, `#savePreviousSongs`, `#ytdlOptions`, `#searchCooldown`, `#emptyCooldown`, `#nsfw`, `#emitAddSongWhenCreatingQueue`, and `#emitAddListWhenCreatingQueue`.

You can check the feature of those options in the [DisTubeOptions](https://distube.js.org/#/docs/DisTube/v3/typedef/DisTubeOptions) documentation.
