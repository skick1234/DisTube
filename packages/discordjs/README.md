# @distube/discordjs

The discord.js adapter for DisTube, with a built-in playback engine.

## Install

```sh
bun add distube @distube/discordjs @distube/youtube @distube/ytdl-core discord.js @discordjs/voice
```

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

See [installation requirements](https://distube.js.org/distube/guides/installation/),
[quick start](https://distube.js.org/distube/guides/quick-start/),
[queue and voice controls](https://distube.js.org/distube/guides/guide/) and
[adapter authoring](https://distube.js.org/distube/guides/adapter-authoring/).
