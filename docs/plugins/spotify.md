---
title: Spotify
description: Resolve Spotify metadata and play it through another source with @distube/spotify.
---

`@distube/spotify` resolves tracks, albums, playlists and artist top tracks, and searches Spotify metadata.
Short `spotify.link` and `spotify.app.link` links expand to the URL they share, which then resolves as if pasted.

## Install

Install alongside `distube` and your adapter. Include a playable source such as YouTube:

```sh
bun add @distube/spotify @distube/youtube @distube/ytdl-core
```

## Example

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { SpotifyPlugin } from "@distube/spotify";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const spotify = new SpotifyPlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [spotify, new YouTubePlugin()] });
const results = await distube.search("artist track", { source: spotify, limit: 5 });
const first = results[0];
if (first) await distube.play(voiceChannel, first);
```

## Options and playback

`SpotifyPluginOptions` has two optional fields, which must be supplied together:

- `clientId`: the Spotify application client ID for client-credentials authentication.
- `clientSecret`: the matching Spotify application client secret.

Without credentials, the plugin uses anonymous web-player authentication. This unofficial method may stop working
or face rate limits. Related-track lookup for autoplay requires credentials.

Spotify does not return audio. Its `stream` returns a search request made from the track name and artists, so
configure another playable source after it. The built-in engine searches other configured plugins in order and
prepares only the first candidate from each until one works. The public Song and queue item remain Spotify's.
[Lavalink](../lavalink/) uses its own preparation order.

Songs expose `album`, `explicit` and `popularity` through typed `pluginData`. Search clamps `limit` to 50 and uses
a zero-based `offset`; an offset above 1000 returns no results. Provider failures are core `DisTubeError` instances
with codes such as `NOT_FOUND`, `UNAVAILABLE` and `RATE_LIMITED`, with `error.source` set to `"spotify"`.

See the [quick start](../guides/quick-start/), [queue and voice controls](../guides/guide/) and
[error handling](../guides/error-handling/) guides.
