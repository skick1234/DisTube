---
title: SoundCloud
description: Play SoundCloud tracks and sets with @distube/soundcloud.
---

`@distube/soundcloud` resolves tracks and sets, searches, supplies related tracks and suggests search completions.

## Install

Install alongside `distube` and your adapter:

```sh
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

Each preparation fetches a fresh, headerless progressive audio URL on `sndcdn.com`. Manifest-only tracks reject
`SOURCE_FAILED`; blocked or non-streamable tracks reject `UNAVAILABLE`. A positive duration marks the resource seekable.
Songs keep their public permalink and expose `plays`, `likes` and `uploader` through typed `pluginData`.
Search clamps `limit` to 50 and uses a zero-based `offset`.

Lavalink can play these URLs through its `http` source, which must be enabled on the node.
Provider failures are core `DisTubeError` instances with codes such as `NOT_FOUND`, `UNAVAILABLE` and `RATE_LIMITED`,
with `error.source` set to `"soundcloud"`.
See the [quick start](../guides/quick-start/), [queue and voice controls](../guides/guide/) and
[error handling](../guides/error-handling/) guides. For remote playback, see [Lavalink](../lavalink/).
