<div align="center">
  <p>
    <a href="https://nodei.co/npm/distube/"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"></a>
  </p>
</div>

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

Require [discord.js](https://discord.js.org) v12 and [FFMPEG](https://www.ffmpeg.org/download.html).

## Documentation

### DisTube
- [play(`message, string`)](https://distube.js.org/DisTube.html#play): play / add video(s) from video url or playlist url. Search for a video if `string` is invalid url.

##### Song management
- [stop(`message`)](https://distube.js.org/DisTube.html#stop): Stop the playing song and clear the queue.
- [jump(`message, num`)](https://distube.js.org/DisTube.html#jump): Jump to the song number in the queue.
- [skip(`message`)](https://distube.js.org/DisTube.html#skip): Skip the current song.
- [pause(`message`)](https://distube.js.org/DisTube.html#pause): Pause the playing song.
- [resume(`message`)](https://distube.js.org/DisTube.html#resume): Resume the paused song.

##### Queue management
- [shuffle(`message`)](https://distube.js.org/DisTube.html#shuffle): Shuffle the server queue.
- [setVolume(`message, percent`)](https://distube.js.org/DisTube.html#setVolume): Set server volume in percentage.
- [setRepeatMode(`message, type`)](https://distube.js.org/DisTube.html#setRepeatMode): Set repeat mode of server `(disabled, repeat a song, repeat all the queue)`.
- [toggleAutoplay(`message`)](https://distube.js.org/DisTube.html#toggleAutoplay): toggle server's auto-play mode.
- [getQueue(`message`)](https://distube.js.org/DisTube.html#getQueue): get the server queue.
- [isPaused(`message`)](https://distube.js.org/DisTube.html#isPaused): Whether or not the server queue is paused.
- [isPlaying(`message`)](https://distube.js.org/DisTube.html#isPlaying): Whether or not the bot is playing music in the server.

##### Events

| Event Name                                                             | Emitted When                                        |
|------------------------------------------------------------------------|-----------------------------------------------------|
| [playSong](https://distube.js.org/DisTube.html#event:playSong)         | Play a new song                                     |
| [playList](https://distube.js.org/DisTube.html#event:playList)         | Play a new playlist                                 |
| [addSong](https://distube.js.org/DisTube.html#event:addSong)           | Add new song to server queue                        |
| [addList](https://distube.js.org/DisTube.html#event:addList)           | Add playlist to server queue                        |
| [empty](https://distube.js.org/DisTube.html#event:empty)               | There is no user in VoiceChannel                    |
| [finish](https://distube.js.org/DisTube.html#event:finish)             | There is no more music in the queue                 |
| [stop](https://distube.js.org/DisTube.html#event:stop)                 | The queue is stopped by stop() method               |
| [noRelated](https://distube.js.org/DisTube.html#event:noRelated)       | DisTube cannot find related songs to play           |
| [searchResult](https://distube.js.org/DisTube.html#event:searchResult) | Return results after searching (searchSongs = true) |
| [searchCancel](https://distube.js.org/DisTube.html#event:searchCancel) | Cancel selecting results (searchSongs = true)       |
| [error](https://distube.js.org/DisTube.html#event:error)               | An error encountered                                |

See more definitions, properties and events details in the [Documentation page](https://distube.js.org/).

## Example Bot

- [DisTube-Bot](https://github.com/skick1234/DisTube-Bot) - In development :>

```javascript
// DisTube example bot, definitions, properties and events details in the Documentation page.
const Discord = require('discord.js'),
    DisTube = require('distube'),
    client = new Discord.Client(),
    config = {
        prefix: ".",
        token: process.env.TOKEN || "Your Discord Token"
    };

// Create a new DisTube
const distube = new DisTube(client, { searchSongs: true, emitNewSongOnly: true });

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on("message", async (message) => {
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    const command = args.shift();

    if (command == "play")
        distube.play(message, args.join(" "));

    if (["repeat", "loop"].includes(command))
        distube.setRepeatMode(message, parseInt(args[0]));

    if (command == "stop")
        distube.stop(message);

    if (command == "queue") {
        let queue = distube.getQueue(message);
        message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
            `**${id+1}**. [${song.name}](${song.url}) - \`${song.formattedDuration}\``
        ).join("\n"));
    }
});

// Queue status template
const status = (queue) => `Volume: \`${queue.volume}%\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "All Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;

// DisTube event listeners, more in the documentation page
distube.on("playSong", (message, queue, song) => message.channel.send(
    `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
));

distube.on("addSong", (message, queue, song) => message.channel.send(
    `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`
));

distube.on("playList", (message, queue, playlist, song) => message.channel.send(
    `Play \`${playlist.title}\` playlist (${playlist.total_items} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
));

distube.on("addList", (message, queue, playlist) => message.channel.send(
    `Added \`${playlist.title}\` playlist (${playlist.total_items} songs) to queue\n${status(queue)}`
));

// DisTubeOptions.searchSongs = true
distube.on("searchResult", (message, result) => {
    let i = 0;
    message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.duration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
});

// DisTubeOptions.searchSongs = true
distube.on("searchCancel", (message) => message.channel.send(`Searching canceled`));

distube.on("error", (message, err) => message.channel.send(
    "An error encountered: " + err
));

client.login(config.token);
```