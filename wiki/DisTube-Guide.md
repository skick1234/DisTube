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

# Installation

1.  Install DisTube and required dependencies in your bot project:

    ```sh
    npm install distube @discordjs/voice @discordjs/opus
    ```

2.  Install FFmpeg. See the guides for:

    - [Windows](http://blog.gregzaal.com/how-to-install-ffmpeg-on-windows/)
    - [Linux (Ubuntu, Mint,...)](https://www.tecmint.com/install-ffmpeg-in-linux/)

    If the links above are unavailable, download FFmpeg from [this repo](https://github.com/BtbN/FFmpeg-Builds/releases).

> [!WARNING]
> Avoid using `ffmpeg-static` due to potential stability issues across different machines. Also, do NOT install the `ffmpeg` npm package. Uninstall it if installed with `npm uninstall ffmpeg`.

3. Encryption Libraries

> [!NOTE]
> You only need to install one of these libraries if your system does not support `aes-256-gcm` (verify by running `require('node:crypto').getCiphers().includes('aes-256-gcm')`).

- [@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers)
- [sodium-native](https://www.npmjs.com/package/sodium-native)
