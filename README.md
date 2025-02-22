<div align="center">
  <p>
    <a href="https://www.npmjs.com/package/distube" target="_blank"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"/></a>
  </p>
  <p>
    <a href="https://github.com/skick1234/DisTube/actions" target="_blank"><img alt="GitHub Workflow Status" src="https://img.shields.io/github/actions/workflow/status/skick1234/DisTube/test.yml?branch=main&label=Tests&logo=github&style=flat-square" /></a>
    <a href="https://nodejs.org/" target="_blank"><img alt="node-current" src="https://img.shields.io/node/v/distube?logo=node.js&logoColor=white&style=flat-square"/></a>
    <a href="https://discord.js.org/" target="_blank"><img alt="npm peer dependency version" src="https://img.shields.io/npm/dependency-version/distube/peer/discord.js?label=discord.js&logo=discord&logoColor=white&style=flat-square"/></a>
    <a href="https://app.codecov.io/gh/skick1234/DisTube" target="_blank"><img alt="Codecov branch" src="https://img.shields.io/codecov/c/github/skick1234/DisTube/main?logo=codecov&logoColor=white&style=flat-square&token=WWDYRRSEQW"/></a>
    <br/>
    <a href="https://www.npmjs.com/package/distube" target="_blank"><img alt="npm" src="https://img.shields.io/npm/dt/distube?logo=npm&style=flat-square"/></a>
    <a href="https://github.com/skick1234/DisTube/stargazers" target="_blank"><img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/skick1234/DisTube?logo=github&logoColor=white&style=flat-square"/></a>
    <a href="https://discord.gg/feaDd9h" target="_blank"><img alt="Discord" src="https://img.shields.io/discord/732254550689316914?logo=discord&logoColor=white&style=flat-square"/></a>
  </p>
  <p>
    <a href='https://ko-fi.com/skick' target='_blank'><img height='48' src='https://storage.ko-fi.com/cdn/kofi3.png' alt='Buy Me a Coffee at ko-fi.com' /></a>
  </p>
</div>

# DisTube

DisTube is a comprehensive Discord music bot library built for Discord.js, offering simplified music commands, effortless playback from diverse sources, and integrated audio filters.

## 🌟 Features

- **Easy Integration**: Built on top of [discord.js](https://discord.js.org) v14 and [@discordjs/voice](https://discord.js.org)
- **Voice Management**: Robust handling of voice connections and queue management
- **Audio Filters**: Built-in filters (bassboost, echo, karaoke, etc.) and custom filter support
- **Plugin System**: Extensible architecture supporting various music sources through plugins
- **Type Safety**: Written in TypeScript for better development experience
- **Active Community**: Join our [Discord Support Server](https://discord.gg/feaDd9h) for help

## 📋 Requirements

- Node.js 18.17.0 or higher
- [discord.js](https://discord.js.org) v14
- [@discordjs/voice](https://github.com/discordjs/voice)
- [@discordjs/opus](https://github.com/discordjs/opus)
- [FFmpeg](https://www.ffmpeg.org/download.html)

### 🔒 Encryption Libraries

> [!NOTE]
> You only need to install one of these libraries if your system does not support `aes-256-gcm` (verify by running `require('node:crypto').getCiphers().includes('aes-256-gcm')`).

- [@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers)
- [sodium-native](https://www.npmjs.com/package/sodium-native)

## 🚀 Installation

```bash
npm install distube @discordjs/voice @discordjs/opus
```

For FFmpeg installation:

- [Windows Guide](http://blog.gregzaal.com/how-to-install-ffmpeg-on-windows/)
- [Linux Guide](https://www.tecmint.com/install-ffmpeg-in-linux/)

> [!NOTE]
> Alternative FFmpeg builds available [here](https://github.com/BtbN/FFmpeg-Builds/releases)

## 📚 Documentation

- [API Documentation](https://distube.js.org/) - Detailed API reference
- [DisTube Guide](https://github.com/skick1234/DisTube/wiki) - Step-by-step guide for beginners
- [Plugin List](https://github.com/skick1234/DisTube/wiki/Projects-Hub#plugins) - Available plugins for music sources

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guidelines](https://github.com/skick1234/DisTube/blob/main/.github/CONTRIBUTING.md) before submitting a pull request.

## 📄 License

Licensed under [MIT License](https://github.com/skick1234/DisTube/blob/main/LICENSE)

## 💖 Support

<a href='https://ko-fi.com/skick' target='_blank'><img height='48' src='https://storage.ko-fi.com/cdn/kofi3.png' alt='Support me on Ko-fi' /></a>
