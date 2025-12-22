# DisTube Guide

> [!NOTE]
> This guide follows the [discordjs.guide notation](https://discordjs.guide/additional-info/notation.html).

## Introduction

Welcome to the DisTube guide! This tutorial will guide you through creating a Discord bot with music commands using DisTube, a comprehensive Discord music bot library built for Discord.js. DisTube simplifies music commands, offers effortless playback from diverse sources, and provides integrated audio filters.

Let's bring your Discord bot to life with DisTube!

[![Support me on ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/skick)

## Prerequisites

- Solid understanding of JavaScript/TypeScript
- A basic Discord bot set up with Discord.js. Refer to [discordjs.guide](https://discordjs.guide/) if you haven't already.
- Node.js 22.12.0 or higher

Please follow the [[Installation]] guide to set up DisTube and its dependencies before proceeding.

## Getting Started

### 1. Initialize DisTube

First, initialize the DisTube class in your main bot file:

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

### 2. Handling Events

DisTube emits various events to keep you updated on the playback status:

```javascript
const { Events } = require("distube");

distube
  .on(Events.PLAY_SONG, (queue, song) =>
    queue.textChannel?.send(
      `Playing \`${song.name}\` - \`${song.formattedDuration}\`\nRequested by: ${song.user}`,
    ),
  )
  .on(Events.ADD_SONG, (queue, song) =>
    queue.textChannel?.send(
      `Added ${song.name} - \`${song.formattedDuration}\` to the queue by ${song.user}`,
    ),
  )
  .on(Events.ERROR, (error, queue, song) => {
    console.error(error);
    queue.textChannel?.send(`An error occurred: ${error.message.slice(0, 1979)}`);
  })
  .on(Events.EMPTY, queue =>
    queue.textChannel?.send("Voice channel is empty! Leaving the channel...")
  )
  .on(Events.FINISH, queue =>
    queue.textChannel?.send("Queue finished!")
  );
```

### 3. Creating Commands

#### Play Command

The `play` method is the core of DisTube. It handles searching, joining voice channels, and managing the queue:

```javascript
client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;
  const prefix = "!";
  if (!message.content.startsWith(prefix)) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/g);
  const command = args.shift()?.toLowerCase();

  if (command === "play") {
    const voiceChannel = message.member?.voice.channel;
    if (!voiceChannel) {
      return message.channel.send("You must be in a voice channel!");
    }
    const query = args.join(" ");
    if (!query) {
      return message.channel.send("Please provide a song name or URL!");
    }

    try {
      await distube.play(voiceChannel, query, {
        message,
        textChannel: message.channel,
        member: message.member,
      });
    } catch (error) {
      message.channel.send(`Error: ${error.message}`);
    }
  }
});
```

#### Basic Controls

> [!IMPORTANT]
> Always use `queue` methods directly instead of `distube` shortcut methods. The shortcut methods are deprecated and will be removed in v6.0.

```javascript
// Get the queue for the guild
const queue = distube.getQueue(message.guildId);

if (command === "stop") {
  if (!queue) return message.channel.send("Nothing is playing!");
  await queue.stop();
  message.channel.send("Stopped the player!");
}

if (command === "skip") {
  if (!queue) return message.channel.send("Nothing is playing!");
  await queue.skip();
  message.channel.send("Skipped the song!");
}

if (command === "pause") {
  if (!queue) return message.channel.send("Nothing is playing!");
  queue.pause();
  message.channel.send("Paused the song!");
}

if (command === "resume") {
  if (!queue) return message.channel.send("Nothing is playing!");
  queue.resume();
  message.channel.send("Resumed the song!");
}

if (command === "volume") {
  if (!queue) return message.channel.send("Nothing is playing!");
  const volume = parseInt(args[0]);
  if (isNaN(volume) || volume < 0 || volume > 100) {
    return message.channel.send("Please provide a valid volume (0-100)!");
  }
  queue.setVolume(volume);
  message.channel.send(`Volume set to ${volume}%`);
}

if (command === "shuffle") {
  if (!queue) return message.channel.send("Nothing is playing!");
  queue.shuffle();
  message.channel.send("Shuffled the queue!");
}

if (command === "repeat") {
  if (!queue) return message.channel.send("Nothing is playing!");
  const mode = queue.setRepeatMode();
  const modeText = ["Off", "Song", "Queue"][mode];
  message.channel.send(`Repeat mode: ${modeText}`);
}

if (command === "queue") {
  if (!queue) return message.channel.send("Nothing is playing!");
  const songs = queue.songs
    .map((song, i) => `${i === 0 ? "Playing:" : `${i}.`} ${song.name} - \`${song.formattedDuration}\``)
    .join("\n");
  message.channel.send(songs.slice(0, 1990));
}

if (command === "nowplaying" || command === "np") {
  if (!queue) return message.channel.send("Nothing is playing!");
  const song = queue.songs[0];
  message.channel.send(
    `Now playing: ${song.name}\n` +
    `Duration: ${queue.formattedCurrentTime} / ${song.formattedDuration}`
  );
}
```

## Best Practices

### 1. Always Check for Queue Existence

Before performing queue operations, always check if the queue exists:

```javascript
const queue = distube.getQueue(guildId);
if (!queue) {
  return message.reply("Nothing is playing!");
}
```

### 2. Handle Errors Properly

Always wrap `distube.play()` in try-catch and listen to the error event:

```javascript
try {
  await distube.play(voiceChannel, query, options);
} catch (error) {
  // Handle errors like invalid URLs, no results, etc.
  message.reply(`Error: ${error.message}`);
}

// Also handle playback errors
distube.on(Events.ERROR, (error, queue, song) => {
  console.error(`[${queue.id}] Error:`, error);
  queue.textChannel?.send(`Error playing ${song?.name}: ${error.message}`);
});
```

### 3. Use TypeScript for Better Development Experience

DisTube is written in TypeScript and provides full type definitions:

```typescript
import { Client, GatewayIntentBits, Message } from "discord.js";
import { DisTube, Events, Queue, Song } from "distube";

const distube = new DisTube(client);

distube.on(Events.PLAY_SONG, (queue: Queue, song: Song) => {
  // Full type support
});
```

### 4. Clean Up Resources

Leave voice channels when appropriate to free up resources:

```javascript
// Leave when queue finishes
distube.on(Events.FINISH, queue => {
  queue.voice.leave();
});

// Leave when voice channel is empty
import { isVoiceChannelEmpty } from "distube";

client.on("voiceStateUpdate", oldState => {
  if (!oldState?.channel) return;
  const voice = distube.voices.get(oldState);
  if (voice && isVoiceChannelEmpty(oldState)) {
    voice.leave();
  }
});
```

### 5. Use Plugins for Additional Sources

DisTube doesn't include music sources by default. Use official plugins:

```javascript
import { DisTube } from "distube";
import { YouTubePlugin } from "@distube/youtube";
import { SpotifyPlugin } from "@distube/spotify";
import { SoundCloudPlugin } from "@distube/soundcloud";

const distube = new DisTube(client, {
  plugins: [
    new YouTubePlugin(),
    new SpotifyPlugin(),
    new SoundCloudPlugin(),
  ],
});
```

### 6. Configure Queue Defaults

Set default queue properties using the `initQueue` event:

```javascript
distube.on(Events.INIT_QUEUE, queue => {
  queue.autoplay = false;        // Disable autoplay
  queue.setVolume(50);           // Set default volume
  queue.setRepeatMode(0);        // Disable repeat
});
```

## Next Steps

- Explore the [API Documentation](https://distube.js.org/) for all available methods
- Check out [[Audio Effects & Filters]] to enhance the listening experience
- Learn about the [[Plugin System]] to support more music sources
- See [[Handling Discord.js Events]] for advanced voice state handling
- Read [[Frequently Asked Questions]] for common issues and solutions
