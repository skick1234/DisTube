> [!WARNING]
> DisTube Guide is Working in Process

> [!NOTE]
> This guide follows [discordjs.guide notation](https://discordjs.guide/additional-info/notation.html)

# Introduction

Welcome to the guide on creating a Discord bot with DisTube! Whether you're a seasoned developer or just starting, this step-by-step tutorial will walk you through the process of setting up a Discord bot capable of handling music commands with ease. DisTube, a powerful Discord.js module, simplifies the integration of music playback functionality, making your bot not only versatile but also enjoyable for your server members.

Let's dive in and bring your Discord bot to life with the magic of DisTube! 🤖🎵

[![Support me on ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/skick)

# Prerequisites

To create a Discord music bot with DisTube, you should have a solid understanding of JavaScript. You can make a music bot with very little JS, programming knowledge by using DisTube. But you may get stuck on many uncomplicated issues, and struggle with solutions to incredibly easy problems.

# Preparations

Before diving into this guide, you have to create a Discord bot using Discord.js. If you haven't already, visit [discordjs.guide](https://discordjs.guide/) to familiarize yourself with the process of setting up a basic Discord bot.

This guide is a continuation of your [discordjs.guide](https://discordjs.guide/) development journey, focusing on seamlessly integrating DisTube for advanced music functionality.
The code written follows command handling setup from [discordjs.guide](https://discordjs.guide/), so adjustments may be necessary based on your command handler's structure.
If you encounter any issues, refer to your command handler's documentation or seek assistance in the Discord.js community.

# Installation

Install DisTube in your bot project folder

```sh
npm install distube
```

And you need to install all the [requirements](https://github.com/skick1234/DisTube#requirement) too.

```sh
npm install @discordjs/voice @discordjs/opus sodium-native
```

FFmpeg installation guide: [Windows](http://blog.gregzaal.com/how-to-install-ffmpeg-on-windows/) - [Linux (Ubuntu, Mint,...)](https://www.tecmint.com/install-ffmpeg-in-linux/)
\
Download FFmpeg from [this repo](https://github.com/BtbN/FFmpeg-Builds/releases) if the download links in the guide are not available.

> [!WARNING]
> While `ffmpeg-static` may function, it's important to note that its stability can vary across different machines, potentially leading to issues.\
> Do NOT install `ffmpeg` npm package. Uninstall it if installed with `npm uninstall ffmpeg`.
