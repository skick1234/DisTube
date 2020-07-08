# DisTube
A Node.js module to easily manage music commands and play Youtube song on Discord without any API key.

## Features

- Build on discord.js v12
- Easily to use and customize
- Work on multiple servers

## Installation

```npm
npm install distube @discord/opus --save
```

Require [discord.js](discord.js.org) v12 and [FFMPEG](https://www.ffmpeg.org/download.html).

## Documentation

### DisTube
- play(`message, string`): play / add video(s) from video url or playlist url. Search for a video if `string` is invalid url.

##### Song management
- stop(`message`): Stop the playing song and clear the queue.
- jump(`message, num`): Jump to the song number in the queue.
- skip(`message`): Skip the current song.
- pause(`message`): Pause the playing song.
- resume(`message`): Resume the paused song.

##### Queue management
- shuffle(`message`): Shuffle the server queue.
- setVolume(`message, percent`): Set server volume in percentage.
- setRepeatMode(`message, type`): Set repeat mode of server `(disabled, repeat a song, repeat all the queue)`.
- toggleAutoplay(`message`): toggle server's auto-play mode.
- getQueue(`message`): get the server queue.
- isPaused(`message`): Whether or not the server queue is paused.
- isPlaying(`message`): Whether or not the bot is playing music in the server.

##### Events

| Event Name   | Emitted When                                        |
|--------------|-----------------------------------------------------|
| playSong     | Play a new song                                     |
| playList     | Play a new playlist                                 |
| addSong      | Add new song to server queue                        |
| addList      | Add playlist to server queue                        |
| empty        | There is no user in VoiceChannel                    |
| finish       | There is no more music in the queue                 |
| stop         | The queue is stopped by stop() method               |
| noRelated    | DisTube cannot find related songs to play           |
| searchResult | Return results after searching (searchSongs = true) |
| searchCancel | Cancel selecting results (searchSongs = true)       |
| error        | An error encountered                                |

See more definitions, properties and events details in the Documentation.

## Example Bot
- [DisTube-Bot](https://github.com/skick1234/DisTube-Bot)