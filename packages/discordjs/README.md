# @distube/discordjs

The discord.js adapter for DisTube, with a built-in playback engine.

## Install

```sh title="npm"
npm install distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

## Requirements

The built-in engine decodes with `node-av`, an optional dependency. It needs glibc 2.28 or newer, so musl hosts such as
Alpine are unsupported. A host that cannot load it fails the first playback with `VOICE_FAILED`. A bot whose engine
comes from a plugin such as `@distube/lavalink` does not need `node-av`. `UV_THREADPOOL_SIZE` limits concurrent opens.
The engine opens at most one input fewer than the thread pool has threads, and at least one. The pool defaults to 4
threads on Node.js and to the CPU count on Bun, so raise it on Node.js for many guilds at once. `@discordjs/voice`
`^0.19.1` is a peer dependency.

The adapter depends on `@noble/ciphers`. If `generateDependencyReport()` from `@discordjs/voice` lists no cipher, the
package manager hid it from `@discordjs/voice`; install `@noble/ciphers` in your application.

The bot joins a stage channel suppressed. A user promotes it to speaker, and Connect is checked but Speak is not.

## Example

Use a logged-in client with voice-state intents and a cached voice channel:

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});

await distube.play(voiceChannel, "a song title");
```

The adapter joins the native voice connection in a group named after the bot's user ID, so two clients in one guild
hold separate connections. Code that fetches the connection with `getVoiceConnection(guildId)` from
`@discordjs/voice` passes the group: `getVoiceConnection(guildId, clientUserId)`.

See [installation requirements](https://distube.js.org/distube/get-started/installation/),
[quick start](https://distube.js.org/distube/get-started/quick-start/),
[queue controls](https://distube.js.org/distube/recipes/queue-controls/) and
[adapter authoring](https://distube.js.org/distube/extending/adapter-authoring/).
