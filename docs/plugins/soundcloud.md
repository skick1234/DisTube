---
title: SoundCloud
description: Play SoundCloud tracks and sets with @distube/soundcloud.
sidebar:
  order: 3
---

`@distube/soundcloud` lets your bot play SoundCloud. Members can paste a track or set link or search SoundCloud, and
autoplay continues with related tracks. The plugin also suggests completions while a member types. It needs no
account or API key.

## Install

```sh title="npm"
npm install @distube/soundcloud
```

```sh title="Bun"
bun add @distube/soundcloud
```

The [installation guide](../../get-started/installation/) covers `distube` and your adapter.

## Set it up

Put the plugin in the `plugins` array. This example searches SoundCloud and plays the first result:

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

Short `on.soundcloud.com` links work like the full ones. A set stops at the `maxPlaylistSongs` option of `DisTube`.

## Options

Most bots need no options. Add app credentials when SoundCloud rate limits your bot often.

`clientId` and `clientSecret` are the credentials of an app you registered with SoundCloud, which needs an Artist Pro
account. With them, the plugin asks SoundCloud's official API first. Pass both or neither, or construction throws
`INVALID_ARGUMENT`.

SoundCloud hands out only 50 app tokens per 12 hours per app, so keep the token across restarts. `onToken` receives
each new one, and `token` passes a saved one back:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { SoundCloudPlugin, type SoundCloudPluginOptions } from "@distube/soundcloud";

function savedToken(): SoundCloudPluginOptions["token"] {
  try {
    return JSON.parse(readFileSync("soundcloud-token.json", "utf8")) as SoundCloudPluginOptions["token"];
  } catch {
    return undefined;
  }
}

export const soundcloud = new SoundCloudPlugin({
  clientId: process.env.SOUNDCLOUD_CLIENT_ID,
  clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET,
  token: savedToken(),
  onToken: token => writeFileSync("soundcloud-token.json", JSON.stringify(token)),
});
```

`clientIdV2` sets the client ID for SoundCloud's web API. Without it, the plugin reads one from soundcloud.com.

`oauthTokenV2` sends a SoundCloud user's OAuth token with web API requests.

:::caution
Keep the client secret, the saved token and `oauthTokenV2` out of your repository. Anyone who has them can act as your
app or account.
:::

## Errors

A SoundCloud failure reaches your bot as a `DisTubeError` with `error.source` set to `"soundcloud"`.

| Code            | What happened                                                  | What to do                                 |
| --------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `NOT_FOUND`     | The track or set does not exist                                | Check the link                             |
| `UNAVAILABLE`   | The track is blocked, a preview-only snippet or not streamable | Pick another track                         |
| `RATE_LIMITED`  | SoundCloud is throttling your bot                              | Wait, or set `clientId` and `clientSecret` |
| `SOURCE_FAILED` | The track offers only MP3, or SoundCloud could not be read     | Pick another track, or try again later     |

The [error reference](../../reference/errors/) lists every code.
