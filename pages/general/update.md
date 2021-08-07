# Updating your code from v2 to v3

This guide follows [discordjs.guide notation](https://discordjs.guide/additional-info/notation.html#classes)

This guide is WIP, any contribution is appreciated.

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
+ distube.voice.get(message).setSelfMute(true)

- message.guild.me.voice.setSelfDeaf(true) // djs v12
- joinVoiceChannel({..., selfDeaf: true}) // @discordjs/voice
+ distube.voice.get(message).setSelfDeaf(true)
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

You can check the feature of those options in the [DisTubeOptions](/#/docs/DisTube/beta/typedef/DisTubeOptions) documentation.


## DisTube Events

### Changes

v3 doesn't emit `Message` parameter anymore. 100% events are changed. You can check the documentation for details. I will update each event change later.

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
.on("playSong", (queue, song) => {
  let msg = `Playing \`${song.name}\` - \`${song.formattedDuration}\``
  if (song.playlist) msg = `Playlist: ${song.playlist.name}\n${msg}`
  queue.textChannel.send(msg)
})
```

### Addition

New events on v3:

- [deleteQueue](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-deleteQueue)
- [disconnect](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-disconnect)
- [finishSong](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-finishSong)
- [searchDone](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-searchDone)
- [searchInvalidAnswer](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-searchInvalidAnswer)
- [searchNoResult](/#/docs/DisTube/beta/class/DisTube?scrollTo=e-searchNoResult)

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
distube.setFilter(message, "3d")
// Applied filters: 3d
distube.setFilter(message, ["3d", "bassboost", "vaporwave"])
// Applied filters: bassboost, vaporwave
distube.setFilter(message, ["3d", "bassboost", "vaporwave"], true)
// Applied filters: 3d, bassboost, vaporwave
distube.setFilter(message, false)
// No filter applied
```

#### DisTube#search

Add `options` parameter to change limit, type and restricted mode of the results

```js
distube.search("A query", {
  limit: 10,
  type: "video",
  safeSearch: false,
})
```

### Addition

New methods on v3:

- [playVoiceChannel](/#/docs/DisTube/beta/class/DisTube?scrollTo=playVoiceChannel)
- [addRelatedSong](/#/docs/DisTube/beta/class/DisTube?scrollTo=addRelatedSong)
- [previous](/#/docs/DisTube/beta/class/DisTube?scrollTo=previous)

Click above links and read the docs for more information.

## Queue, Song, SearchResult, Playlist, 

Add methods and change some properties, I will update soon.

The documentation is quite clear I suppose, you can read it to update your bot.