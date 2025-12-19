> [!WARNING]
> This DisTube Guide is a work in progress.

> [!NOTE]
> This guide follows the [discordjs.guide notation](https://discordjs.guide/additional-info/notation.html).

# Introduction

Welcome to the DisTube guide! This tutorial will guide you through creating a Discord bot with music commands using DisTube, a comprehensive Discord music bot library built for Discord.js. DisTube simplifies music commands, offers effortless playback from diverse sources, and provides integrated audio filters.

Let's bring your Discord bot to life with DisTube! 🤖🎵

[![Support me on ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/skick)

# Prerequisites

- Solid understanding of JavaScript. While you can create a basic music bot with limited JS knowledge, a strong foundation will help you troubleshoot issues.
- A basic Discord bot set up with Discord.js. Refer to [discordjs.guide](https://discordjs.guide/) if you haven't already.

This guide assumes you're familiar with the command handling setup from [discordjs.guide](https://discordjs.guide/). Adjustments may be needed based on your command handler's structure.

# Prerequisites

- Solid understanding of JavaScript. While you can create a basic music bot with limited JS knowledge, a strong foundation will help you troubleshoot issues.
- A basic Discord bot set up with Discord.js. Refer to [discordjs.guide](https://discordjs.guide/) if you haven't already.

# Installation

Please follow the [[Installation]] guide to set up DisTube and its dependencies (like FFmpeg) before proceeding.

# Getting Started

## 1. Initialize DisTube

First, you need to initialize the DisTube class in your main bot file.

```javascript
const { Client, GatewayIntentBits } = require("discord.js");
const { DisTube } = require("distube");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Create a new DisTube instance
const distube = new DisTube(client, {
  emitNewSongOnly: true,
  emitAddSongWhenCreatingQueue: false,
  emitAddListWhenCreatingQueue: false,
});

client.login("YOUR_BOT_TOKEN");
```

## 2. Handling Events

DisTube emits various events to keep you updated on the playback status. You should listen to these events to interact with your users.

```javascript
distube
  .on("playSong", (queue, song) =>
    queue.textChannel.send(
      `Playing \`${song.name}\` - \`${song.formatDuration()}\`\nRequested by: ${song.user}`,
    )
  )
  .on("addSong", (queue, song) =>
    queue.textChannel.send(
      `Added ${song.name} - \`${song.formatDuration()}\` to the queue by ${song.user}`,
    )
  )
  .on("error", (channel, e) => {
    if (channel) channel.send(`An error encountered: ${e.message.slice(0, 1970)}`);
    else console.error(e);
  })
  .on("empty", channel => channel.send("Voice channel is empty! Leaving the channel..."))
  .on("searchNoResult", (message, query) =>
    message.channel.send(`No result found for \`${query}\`!`)
  )
  .on("finish", queue => queue.textChannel.send("Finished!"));
```

## 3. Creating Commands

Now, let's implement basic music commands. This example uses a simple message-based command handler.

### Play Command

The `play` method is the core of DisTube. It handles searching, joining voice channels, and managing the queue.

```javascript
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  const prefix = "!";
  if (!message.content.startsWith(prefix)) return;
  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift().toLowerCase();

  if (command === "play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) {
      return message.channel.send("You must be in a voice channel to play music!");
    }
    const query = args.join(" ");
    if (!query) {
      return message.channel.send("Please provide a song name or URL!");
    }
    distube.play(voiceChannel, query, {
      message,
      textChannel: message.channel,
      member: message.member,
    });
  }
});
```

### Basic Controls (Skip, Stop, Pause, Resume)

```javascript
  if (command === "stop") {
    distube.stop(message);
    message.channel.send("Stopped the player!");
  }

  if (command === "skip") {
    distube.skip(message);
    message.channel.send("Skipped the song!");
  }

  if (command === "pause") {
    distube.pause(message);
    message.channel.send("Paused the song!");
  }

  if (command === "resume") {
    distube.resume(message);
    message.channel.send("Resumed the song!");
  }
```

# Next Steps

- Explore the [[Public API Reference]] for more advanced methods.
- Learn how to use [[Audio Effects & Filters]] to enhance the listening experience.
- Check out the [[Plugin System]] to support more music sources.
