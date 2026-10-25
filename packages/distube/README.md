# distube

Music queues and voice playback for Discord bots.

## Install

```sh title="npm"
npm install distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

```sh title="Bun"
bun add distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

For Oceanic, install `@distube/oceanic oceanic.js` instead of `@distube/discordjs discord.js`. See
[Installation](https://distube.js.org/distube/guides/installation/).

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

await distube.play(voiceChannel, "never gonna give you up");
```

See [installation requirements](https://distube.js.org/distube/guides/installation/),
[quick start](https://distube.js.org/distube/guides/quick-start/),
[queue and voice controls](https://distube.js.org/distube/guides/guide/),
[plugins](https://distube.js.org/distube/plugins/) and
[plugin authoring](https://distube.js.org/distube/guides/plugin-authoring/).
