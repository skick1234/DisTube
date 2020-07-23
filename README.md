<div align="center">
  <p>
    <a href="https://nodei.co/npm/distube/"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"></a>
  </p>
</div>

# DisTube
A Node.js module to easily manage music commands and play Youtube song on Discord without any API key.
Discord support server: https://discord.gg/feaDd9h

## Features

- Build on discord.js v12
- Easily to use and customize
- Work on multiple servers

## Installation

```npm
npm install distube @discordjs/opus --save
```

Require [discord.js](https://discord.js.org) v12 and [FFMPEG](https://www.ffmpeg.org/download.html).

## Documentation

### DisTube
- [play(`message, string`)](https://distube.js.org/DisTube.html#play): play / add video(s) from video url or playlist url. Search for a video if `string` is invalid url.

##### Song management
- [playSkip(`message, string`)](https://distube.js.org/DisTube.html#play): same as [play()](https://distube.js.org/DisTube.html#play) but it will add new song(s) to the beginning of the queue and skip the playing song.
- [playCustomPlaylist(`message, urls`)](https://distube.js.org/DisTube.html#playCustomPlaylist): Play or add to the queue a list of Youtube video url.
- [stop(`message`)](https://distube.js.org/DisTube.html#stop): Stop the playing song and clear the queue.
- [skip(`message`)](https://distube.js.org/DisTube.html#skip): Skip the current song.
- [jump(`message, num`)](https://distube.js.org/DisTube.html#jump): Jump to the song number in the queue.
- [pause(`message`)](https://distube.js.org/DisTube.html#pause): Pause the playing song.
- [resume(`message`)](https://distube.js.org/DisTube.html#resume): Resume the paused song.

##### Queue management
- [setFilter(`message`, `filter`)](https://distube.js.org/DisTube.html#setFilter) Toggle a filter of the queue, replay playing song. Available filters: `3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`
- [shuffle(`message`)](https://distube.js.org/DisTube.html#shuffle): Shuffle the server queue.
- [setVolume(`message, percent`)](https://distube.js.org/DisTube.html#setVolume): Set server volume in percentage.
- [setRepeatMode(`message, type`)](https://distube.js.org/DisTube.html#setRepeatMode): Set repeat mode of server `(disabled, repeat a song, repeat all the queue)`.
- [toggleAutoplay(`message`)](https://distube.js.org/DisTube.html#toggleAutoplay): Toggle server's auto-play mode.
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
| [noRelated](https://distube.js.org/DisTube.html#event:noRelated)       | DisTube cannot find related songs to play           |
| [searchResult](https://distube.js.org/DisTube.html#event:searchResult) | Return results after searching (searchSongs = true) |
| [searchCancel](https://distube.js.org/DisTube.html#event:searchCancel) | Cancel selecting results (searchSongs = true)       |
| [error](https://distube.js.org/DisTube.html#event:error)               | An error encountered                                |

See more definitions, properties and events details in the [Documentation page](https://distube.js.org/).

## Example Bot

- [DisTube-Bot](https://github.com/skick1234/DisTube-Bot) - [Invite Bot](https://discord.com/api/oauth2/authorize?client_id=730011243041128478&permissions=3238976&scope=bot)

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
const distube = new DisTube(client, { searchSongs: true, emitNewSongOnly: true, highWaterMark: 1 << 25 });

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
});

client.on("message", async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(config.prefix)) return;
    const args = message.content.slice(config.prefix.length).trim().split(/ +/g);
    const command = args.shift();

    if (command == "play")
        distube.play(message, args.join(" "));

    if (["repeat", "loop"].includes(command))
        distube.setRepeatMode(message, parseInt(args[0]));

    if (command == "stop") {
        distube.stop(message);
        message.channel.send("Stopped the music!");
    }

    if (command == "queue") {
        let queue = distube.getQueue(message);
        message.channel.send('Current queue:\n' + queue.songs.map((song, id) =>
            `**${id + 1}**. ${song.name} - \`${song.formattedDuration}\``
        ).join("\n"));
    }

    if ([`3d`, `bassboost`, `echo`, `karaoke`, `nightcore`, `vaporwave`].includes(command)) {
        let filter = distube.setFilter(message, command);
        message.channel.send("Current queue filter: " + (filter || "Off"));
    }
});

// Queue status template
const status = (queue) => `Volume: \`${queue.volume}%\` | Filter: \`${queue.filter || "Off"}\` | Loop: \`${queue.repeatMode ? queue.repeatMode == 2 ? "All Queue" : "This Song" : "Off"}\` | Autoplay: \`${queue.autoplay ? "On" : "Off"}\``;

// DisTube event listeners, more in the documentation page
distube
    .on("playSong", (message, queue, song) => message.channel.send(
        `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}\n${status(queue)}`
    ))
    .on("addSong", (message, queue, song) => message.channel.send(
        `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`
    ))
    .on("playList", (message, queue, playlist, song) => message.channel.send(
        `Play \`${playlist.title}\` playlist (${playlist.total_items} songs).\nRequested by: ${song.user}\nNow playing \`${song.name}\` - \`${song.formattedDuration}\`\n${status(queue)}`
    ))
    .on("addList", (message, queue, playlist) => message.channel.send(
        `Added \`${playlist.title}\` playlist (${playlist.total_items} songs) to queue\n${status(queue)}`
    ))
    // DisTubeOptions.searchSongs = true
    .on("searchResult", (message, result) => {
        let i = 0;
        message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.title} - \`${song.duration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
    })
    // DisTubeOptions.searchSongs = true
    .on("searchCancel", (message) => message.channel.send(`Searching canceled`))
    .on("error", (message, err) => message.channel.send(
        "An error encountered: " + err
    ));

client.login(config.token);
```