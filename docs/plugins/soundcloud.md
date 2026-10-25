---
title: SoundCloud
description: Play SoundCloud tracks and sets with @distube/soundcloud.
---

`@distube/soundcloud` resolves tracks and sets, searches, supplies related tracks and suggests search completions.

## Install

Install alongside `distube` and your adapter:

```sh title="npm"
npm install @distube/soundcloud
```

```sh title="Bun"
bun add @distube/soundcloud
```

## Example

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SoundCloudPlugin } from "@distube/soundcloud";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const soundcloud = new SoundCloudPlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [soundcloud] });
const results = await distube.search("electronic", { source: soundcloud, limit: 5 });
const first = results[0];
if (first) await distube.play(voiceChannel, first);
```

## Options and playback

`SoundCloudPluginOptions` has two optional fields:

- `clientId`: a SoundCloud client ID, discovered from SoundCloud's scripts on first use when absent.
- `oauthToken`: a token sent as `Authorization: OAuth <token>` on API requests.

Requests use a fixed host allowlist and timeout and follow at most 5 redirects, each checked against the allowlist.
Cancellation and plugin disposal abort pending requests.
Short `on.soundcloud.com` links expand to the URL they share, which then resolves as if pasted.

Each preparation fetches a fresh link for the highest-bitrate AAC HLS transcoding and returns a timed mp4 resource
with no URL. Tracks that offer only MP3 reject `SOURCE_FAILED`, as do segment hosts outside the allowlist
(`media-streaming.soundcloud.cloud`); blocked or non-streamable tracks reject `UNAVAILABLE`.
Songs keep their public permalink and expose `plays`, `likes` and `uploader` through typed `pluginData`.
Search clamps `limit` to 50 and uses a zero-based `offset`.

A Lavalink node loads a SoundCloud Song through its permalink, or plays the first search hit for its name and artist.
Provider failures are core `DisTubeError` instances with codes such as `NOT_FOUND`, `UNAVAILABLE` and `RATE_LIMITED`,
with `error.source` set to `"soundcloud"`.
See the [quick start](../guides/quick-start/), [queue and voice controls](../guides/guide/) and
[error handling](../guides/error-handling/) guides. For remote playback, see [Lavalink](../lavalink/).
