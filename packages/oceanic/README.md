# @distube/oceanic

The Oceanic adapter for DisTube, with a built-in playback engine.

## Install

```sh
bun add distube @distube/oceanic @distube/youtube @distube/ytdl-core oceanic.js
```

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

See [installation requirements](https://distube.js.org/distube/guides/installation/),
[quick start](https://distube.js.org/distube/guides/quick-start/),
[queue and voice controls](https://distube.js.org/distube/guides/guide/) and
[adapter authoring](https://distube.js.org/distube/guides/adapter-authoring/).
