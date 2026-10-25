# @distube/oceanic

The Oceanic adapter for DisTube, with a built-in playback engine.

## Install

```sh title="npm"
npm install distube @distube/oceanic @distube/youtube @distube/ytdl-core oceanic.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/oceanic @distube/youtube @distube/ytdl-core oceanic.js @discordjs/voice
```

## Requirements

The adapter depends on `@noble/ciphers`. If `generateDependencyReport()` from `@discordjs/voice` lists no cipher, the
package manager hid it from `@discordjs/voice`; install `@noble/ciphers` in your application.

The bot joins a stage channel suppressed. A user promotes it to speaker, and Connect is checked but Speak is not.

## Example

Use a logged-in client with voice-state intents and a cached voice channel:

```ts
import { OceanicAdapter } from "@distube/oceanic";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "oceanic.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube({
  adapter: new OceanicAdapter(client),
  plugins: [new YouTubePlugin()],
});

await distube.play(voiceChannel, "a song title");
```

The adapter joins the native voice connection in a group named after the bot's user ID, so two clients in one guild
hold separate connections. Code that fetches the connection with `getVoiceConnection(guildId)` from
`@discordjs/voice` passes the group: `getVoiceConnection(guildId, clientUserId)`.

See [installation requirements](https://distube.js.org/distube/guides/installation/),
[quick start](https://distube.js.org/distube/guides/quick-start/),
[queue and voice controls](https://distube.js.org/distube/guides/guide/) and
[adapter authoring](https://distube.js.org/distube/guides/adapter-authoring/).
