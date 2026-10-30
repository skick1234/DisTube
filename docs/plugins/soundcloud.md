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

Short `on.soundcloud.com` links expand to the URL they share, which then plays as if the member pasted it.

## Options

`new SoundCloudPlugin()` takes optional fields. Most bots need none of them and use api-v2, SoundCloud's web API.

`clientId` and `clientSecret` are a registered SoundCloud app's credentials. Pass both or neither. Registering an app
needs an Artist Pro account.

`token` is a saved app token with `{ accessToken, refreshToken?, expiresAt }`, where `expiresAt` is epoch milliseconds.
`onToken(token)` receives each new app token. Save it and pass it as `token` after a restart to reuse it. SoundCloud
allows only 50 client-credential tokens per 12 hours per app, and 30 per hour per IP. Both options need `clientId` and
`clientSecret`.

Construction throws `INVALID_ARGUMENT` if only one credential is set, or if `token` or `onToken` is set without them.

`clientIdV2` is the web app's client ID. Without it, the plugin reads one from soundcloud.com on first use.

The plugin sends `oauthTokenV2` as `Authorization: OAuth <token>` to api-v2.

`soundcloakUrls` lists [Soundcloak](https://github.com/maid-zone/soundcloak) instances by base URL, and is empty by
default. Playback asks them in order once every SoundCloud API host is rate limited. Their redirect must point at the
SoundCloud CDN.

:::caution
A Soundcloak instance receives only the track's permalink path, never your client ID or OAuth token. For a private
link, that path holds the link's secret token, so only list instances you trust.
:::

## Songs and search results

Songs keep their public permalink as `url`. `song.id` is always the numeric track ID, whichever API answered. They
expose `plays`, `likes` and `uploader` through typed `pluginData`. `song.ageRestricted` holds the publisher's explicit
flag on label releases and is unset on other uploads.

Search returns at most 50 results per call, and `offset` counts from zero.

Preview-only tracks, such as Go+ snippets, reject `UNAVAILABLE` when resolved or prepared. Search, related tracks and
playlists leave them out.

## How playback works

With `clientId` and `clientSecret`, resolve, search, related and stream lookups ask the official API first. Any failure
except a caller abort falls back to api-v2. Without credentials, the plugin uses api-v2 only. `suggest` always uses
api-v2.

Each time a track is about to play, the plugin fetches a fresh link to its highest-bitrate AAC HLS stream and plays it
as a `timed` MP4 resource with no URL. On api-v2, a track that came from this plugin's search, link, related or set
answers needs no second lookup.

The plugin only talks to an allowlist of SoundCloud hosts, with a timeout, and follows at most 5 redirects, checking
each one against the list. Cancelling a call, or disposing the plugin, aborts its pending requests.

With [Lavalink](../lavalink/), the node loads a SoundCloud Song through its permalink, or plays the first search hit for
its name and artist.

## Rate limits

After a `429` the plugin sends nothing to that host until its `Retry-After` wait passes, or for 60 seconds when the
header is missing or invalid. This also applies to the official API; a paused official API falls back to api-v2.

During playback preparation, a rate-limited track lookup or stream link on `api-v2.soundcloud.com` falls back to
`api-widget.soundcloud.com`, then `api-mobi.soundcloud.com`, at most once each, skipping paused hosts. When all three
are rate limited, playback moves on to `soundcloakUrls`. Other web API operations use only api-v2.

If the plugin fails to read a client ID from soundcloud.com, it disables api-v2 for 10 minutes. With app credentials,
operations use only the official API during that time. Without them, operations reject `SOURCE_FAILED`. `suggest`
also rejects `SOURCE_FAILED`, even with app credentials. After 10 minutes, the next api-v2 operation tries the read
again.

## Errors

A SoundCloud failure reaches your bot as a `DisTubeError` with `error.source` set to `"soundcloud"`. Its message names
the host and path, and a `429` also names its `Retry-After` wait. A failed track or stream lookup sets `error.media` to
`"song"`, and a failed set lookup sets it to `"playlist"`.

| Code            | What happened                                                                            |
| --------------- | ---------------------------------------------------------------------------------------- |
| `NOT_FOUND`     | The track or set does not exist                                                          |
| `UNAVAILABLE`   | The track is blocked, preview-only or not streamable                                     |
| `RATE_LIMITED`  | SoundCloud is throttling your bot                                                        |
| `SOURCE_FAILED` | The track offers only MP3, or its stream segments come from a host outside the allowlist |

The [error reference](../../reference/errors/) lists every code, and the [queue reference](../../reference/queue/)
covers adding Songs to a queue. New to DisTube? Start with the [quick start](../../get-started/quick-start/).
