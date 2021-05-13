<div align="center">
  <p>
    <a href="https://nodei.co/npm/distube/"><img src="https://nodei.co/npm/distube.png?downloads=true&downloadRank=true&stars=true"></a>
  </p>
  <p>
    <img alt="npm" src="https://img.shields.io/npm/dt/distube">
    <img alt="Depfu" src="https://img.shields.io/depfu/skick1234/DisTube">
    <img alt="Codacy Grade" src="https://img.shields.io/codacy/grade/79c8b7d7d026410f8e1b7e9d326167a7?label=Codacy%20Score">
    <img alt="CodeFactor Grade" src="https://img.shields.io/codefactor/grade/github/skick1234/DisTube?label=Codefactor%20Score">
  </p>
</div>

# DisTube

A Discord.js module to simplify your music commands and play songs with audio filters on Discord without any API key.

[DisTube Support Server](https://discord.gg/feaDd9h) - [Frequently Asked Questions](https://github.com/skick1234/DisTube/wiki/Frequently-Asked-Questions)

## Features

- Build on discord.js v12
- Easily to use and customize
- Support YouTube, SoundCloud, Facebook, and [700+ more sites](https://ytdl-org.github.io/youtube-dl/supportedsites.html)
- Audio filters (bassboost, nightcore, vaporwave,...)
- Autoplay related YouTube songs
- Prebuilt server queue
- Multiple servers compatible

## Installation

```npm
npm install distube
```

### Requirement

- Node v14.x or higher
- [discord.js](https://discord.js.org) v12 / master branch (v13)
- [FFmpeg](https://www.ffmpeg.org/download.html) - `npm install ffmpeg-static`
- [@discordjs/opus](https://github.com/discordjs/opus) - `npm install @discordjs/opus`
- [python](https://www.python.org/) _(For [`youtube-dl`](http://ytdl-org.github.io/youtube-dl/) to support [700+ more sites](https://ytdl-org.github.io/youtube-dl/supportedsites.html).)_

## Documentation

Read DisTube's definitions, properties and events details in the [Documentation page](https://distube.js.org/).

## Example Bot

- [DisTube Bot](https://skick.xyz/DisTube) - A music bot with reaction controller, filters, DJ mode, user's custom playlist and voting.
- [DisTube Example](https://github.com/distubejs/example) - Example bot with simple command handler.
- [DisTube Guide](https://distube.js.org/guide) - How to build a music bot from scratch.
