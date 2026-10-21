---
title: Spotify
description: "Install and configure @distube/spotify, covering anonymous or official authentication, collections and error codes."
---

Official Spotify `SourcePlugin` for DisTube v6.

Install the package next to `distube`:

```sh
bun add @distube/spotify
```

```ts
import { SpotifyPlugin } from "@distube/spotify";
import { DisTube } from "distube";
import type { Adapter } from "distube/integrations";

declare const adapter: Adapter;

const spotify = new SpotifyPlugin();
const distube = new DisTube({ adapter, sources: [spotify] });
const results = await spotify.search("artist track");
const first = results[0];
if (first) await distube.play({ guildId: "guild", id: "voice" }, first);
```

The plugin owns Spotify authentication, track/album/playlist resolution, search, ordered collection expansion,
metadata, failures, and cleanup. Its `stream` result is an explicit normalized search query containing the
track title followed by artist names in provider order. It never treats a Spotify page as playable media, substitutes
the public Song, selects another provider itself, or creates QueueItems.

`resolve(url, options?)` returns `Song | Playlist | undefined`: one Song for a track URL, one ordered `Playlist` for an
album, playlist, or artist top-track page, and `undefined` to decline a URL the plugin does not own.
`related(song, { signal, exclude })` skips tracks whose id appears in `exclude` and is credential-gated: it uses
Spotify's recommendation lookup only when both `clientId` and
`clientSecret` are configured, and declines unconditionally under anonymous authentication, which has no access to that
endpoint. Autoplay from a Spotify Song therefore requires official credentials.

## Provider data

A Song carries `thumbnail` from album cover art, `name`, and an `artist` string containing the provider's artist
names in billing order. Playback fallback normalizes `name` and `artist` into its search query. Provider display data
lives in the typed `pluginData` slot: `SpotifyData` holds `album`, `explicit` and `popularity`; Spotify reports no view
counts or live state, so there are none. Collection artwork belongs to the Playlist thumbnail, and a Playlist's
`pluginData` is `SpotifyPlaylistData` naming the page `kind` (`album`, `playlist` or `artist`).

Failures the provider distinguishes reject with a `DisTubeError` carrying a `SpotifyErrorCode`: `SPOTIFY_NOT_FOUND`
(HTTP 404) and `SPOTIFY_RATE_LIMITED` (HTTP 429). Any other failure stays a generic provider error that core maps to
`SOURCE_FAILED`.

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit`, and a zero-based `offset`. The default
limit is **10** and the maximum is **50**, with `offset` up to 1000 — the bounds the Web API itself serves; the window
maps directly onto its `limit`/`offset` parameters, so consecutive windows are disjoint in provider order. A window
past the available results returns an empty list; an out-of-range `limit` or `offset` rejects with `INVALID_ARGUMENT`
before any request.

Album and playlist expansion follows Spotify's `next` links in provider order, cancellable between pages, and stops
after twenty pages.

The default provider uses Spotify's anonymous web-player authentication. Supplying both `clientId` and `clientSecret`
selects Spotify's official client-credentials flow instead; supplying only one is rejected. Anonymous authentication
is unofficial and may be rate-limited or changed by Spotify. `SpotifyPluginOptions.network` configures request timeout,
streamed byte, redirect, and explicit trusted-private-host limits. Authentication/API destinations, ordered
album/playlist pagination, cancellation between pages, response shapes, and redaction are enforced before a result is
accepted. An injected `SpotifyProvider` must honor the same AbortSignal, disposal, ownership, ordering, validation, and
safety obligations.
