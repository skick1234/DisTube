<div align="center">
  <p>
    <a href="https://www.npmjs.com/package/distube" target="_blank"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"/></a>
  </p>
  <p>
    <a href="https://www.npmjs.com/package/distube" target="_blank"><img alt="npm" src="https://img.shields.io/npm/dt/distube?logo=npm&style=flat-square"/></a>
    <a href="https://github.com/skick1234/DisTube/stargazers" target="_blank"><img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/skick1234/DisTube?logo=github&logoColor=white&style=flat-square"/></a>
    <a href="https://discord.gg/feaDd9h" target="_blank"><img alt="Discord" src="https://img.shields.io/discord/732254550689316914?logo=discord&logoColor=white&style=flat-square"/></a>
    <br/>
    <a href="https://github.com/skick1234/DisTube/actions" target="_blank"><img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/skick1234/DisTube/test.yml?branch=main&label=Tests&logo=github&style=flat-square" /></a>
    <a href="https://nodejs.org/" target="_blank"><img alt="node-current" src="https://img.shields.io/node/v/distube?logo=node.js&logoColor=white&style=flat-square"/></a>
  </p>
    <a href='https://ko-fi.com/skick' target='_blank'><img height='48' src='https://storage.ko-fi.com/cdn/kofi3.png' alt='Buy Me a Coffee at ko-fi.com' /></a>
</div>

# DisTube

DisTube is a comprehensive Discord music bot library built for [discord.js](https://discord.js.org) and [Oceanic](https://github.com/OceanicJS/Oceanic), offering simplified music commands, effortless playback from diverse sources, and integrated audio filters.

## 🌟 Key Features

- **Easy Integration**: Adapters for [discord.js](https://discord.js.org) v14 (`@distube/discordjs`) and [Oceanic](https://github.com/OceanicJS/Oceanic) (`@distube/oceanic`).
- **Voice Management**: Robust handling of voice connections and queue management.
- **Audio Filters**: Built-in filters (bassboost, echo, karaoke, etc.) and custom filter support.
- **Plugin System**: Extensible architecture supporting YouTube, Spotify, SoundCloud, 700+ other sites and Lavalink.
- **Type Safety**: Written in TypeScript for a superior development experience.

## 📚 Resources

| Resource                                                                                  | Description                                 |
| ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/skick1234/DisTube) | Learn DisTube with AI-powered assistance.   |
| [Installation](https://distube.js.org/distube/get-started/installation/)                  | Detailed requirements and setup guide.      |
| [API Reference](https://distube.js.org/)                                                  | Complete technical documentation.           |
| [Discord Support](https://discord.gg/feaDd9h)                                             | Join our community for help and discussion. |

## 🚀 Quick Start

```bash
npm install distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

For Oceanic, install `@distube/oceanic oceanic.js` instead of `@distube/discordjs discord.js`.

```javascript
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Client, GatewayIntentBits } from "discord.js";
import { DisTube } from "distube";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});

distube.on("queue.item.started", ({ item }) =>
  item.metadata.textChannel.send(`Playing \`${item.song.name}\` - \`${item.song.formattedDuration}\``),
);

client.on("messageCreate", message => {
  if (message.content.startsWith("!play")) {
    distube
      .play(message.member.voice.channel, message.content.slice(6), {
        metadata: { textChannel: message.channel },
      })
      .catch(error => message.reply(error.message));
  }
});

client.login("TOKEN");
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](https://github.com/skick1234/DisTube/blob/main/.github/CONTRIBUTING.md) before submitting a pull request.

## 📄 License

Licensed under [MIT License](https://github.com/skick1234/DisTube/blob/main/LICENSE)

---

<div align="center">
  <a href='https://ko-fi.com/skick' target='_blank'><img height='48' src='https://storage.ko-fi.com/cdn/kofi3.png' alt='Support me on Ko-fi' /></a>
</div>
