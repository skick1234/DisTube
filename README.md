# DisTube v6

Music queues and voice playback for Discord bots, with discord.js and Oceanic adapters.

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

await distube.play(voiceChannel, "never gonna give you up");
```

See [installation requirements](https://distube.js.org/distube/get-started/installation/),
[quick start](https://distube.js.org/distube/get-started/quick-start/),
[queue controls](https://distube.js.org/distube/recipes/queue-controls/) and
[plugins](https://distube.js.org/distube/plugins/).
