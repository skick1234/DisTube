<div align="center">
  <p>
    <a href="https://nodei.co/npm/distube/"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"></a>
  </p>
  <p>
    <img alt="npm" src="https://img.shields.io/npm/dt/distube">
    <img alt="Codacy Grade" src="https://img.shields.io/codacy/grade/79c8b7d7d026410f8e1b7e9d326167a7?label=Codacy%20Score">
    <img alt="CodeFactor Grade" src="https://img.shields.io/codefactor/grade/github/skick1234/DisTube?label=Codefactor%20Score">
  </p>
</div>

# DisTube

A Discord.js module to manage music commands and play songs on Discord without any API key.

[DisTube Support Server](https://discord.gg/feaDd9h) - [Frequently Asked Questions](https://github.com/skick1234/DisTube/wiki/Frequently-Asked-Questions)

## Features

- Support YouTube, SoundCloud, Facebook, and [700+ more sites](https://ytdl-org.github.io/youtube-dl/supportedsites.html).
- Build on discord.js v12
- Easily to use and customize
- Work on multiple servers

## Installation

```npm
npm install distube
```

### Requirement
- [discord.js](https://discord.js.org) v12
- [FFmpeg](https://www.ffmpeg.org/download.html) - `npm install ffmpeg-static`
- [@discordjs/opus](https://github.com/discordjs/opus) - `npm install @discordjs/opus`
- [python](https://www.python.org/) *(For [`youtube-dl`](http://ytdl-org.github.io/youtube-dl/) to support [700+ more sites](https://ytdl-org.github.io/youtube-dl/supportedsites.html).)*

## Documentation

Read DisTube's definitions, properties and events details in the [Documentation page](https://distube.js.org/).

## Example Bot

- [DisTube-Bot](https://skick.xyz/DisTube) - A music bot with reaction controller, filters, DJ mode, user's custom playlist and voting.
- [DisTube-Example](https://github.com/skick1234/DisTube-Example) - Example bot with simple command handler.

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
        message.channel.send(`**Choose an option from below**\n${result.map(song => `**${++i}**. ${song.name} - \`${song.formattedDuration}\``).join("\n")}\n*Enter anything else or wait 60 seconds to cancel*`);
    })
    // DisTubeOptions.searchSongs = true
    .on("searchCancel", (message) => message.channel.send(`Searching canceled`))
    .on("error", (message, err) => message.channel.send(
        "An error encountered: " + err
    ));

client.login(config.token);
```