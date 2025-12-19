# Installation

DisTube depends on several libraries and system tools to function correctly. This guide will walk you through setting everything up.

## Requirements

- **Node.js**: `18.17.0` or higher
- **discord.js**: `v14`
- **@discordjs/voice**: Required for audio handling
- **@discordjs/opus**: Opus encoding/decoding
- **FFmpeg**: Required for audio processing and filtering

## 1. Install via Package Manager

Install DisTube and its peer dependencies in your project:

```bash
npm install distube @discordjs/voice @discordjs/opus
```

> [!TIP]
> You can also use `yarn` or `pnpm`.

## 2. Install FFmpeg

DisTube uses FFmpeg for audio processing. You must have it installed on your system and added to your PATH.

- **Windows**: [Download Guide](http://blog.gregzaal.com/how-to-install-ffmpeg-on-windows/)
- **Linux (Ubuntu/Debian)**: `sudo apt-get install ffmpeg`
- **MacOS**: `brew install ffmpeg`

> [!NOTE]
> If the links above are unavailable, you can find static builds [here](https://github.com/BtbN/FFmpeg-Builds/releases).

> [!WARNING]
> Do NOT install the `ffmpeg` or `ffmpeg-static` npm packages, as they can cause stability and performance issues.

## 3. Encryption Libraries

Discord.js requires an encryption library for voice support. DisTube will work with any library supported by `@discordjs/voice`.

Check if your system supports `aes-256-gcm` natively:
```javascript
require('node:crypto').getCiphers().includes('aes-256-gcm')
```

If it returns `false`, you **must** install one of the following:

- [@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers) (Recommended)
- [sodium-native](https://www.npmjs.com/package/sodium-native)

```bash
npm install @noble/ciphers
```
