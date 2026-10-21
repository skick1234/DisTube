---
title: SoundCloud
description: "Install and configure @distube/soundcloud, covering tracks, sets, search, playback and error codes."
---

Official SoundCloud `SourcePlugin` for DisTube v6.

Install the package next to `distube`:

```sh
bun add @distube/soundcloud
```

```ts
import { SoundCloudPlugin } from "@distube/soundcloud";
import { DisTube } from "distube";
import type { Adapter } from "distube/integrations";

declare const adapter: Adapter;

const soundcloud = new SoundCloudPlugin();
const distube = new DisTube({ adapter, sources: [soundcloud] });
const results = await soundcloud.search("electronic");
const first = results[0];
if (first) await distube.play({ guildId: "guild", id: "voice" }, first);
```

The plugin owns SoundCloud client policy, URL and playlist resolution, search, ordered metadata, provider failures,
and cleanup. It returns canonical public `Song` values and declines non-SoundCloud URLs. Immediately before playback,
`stream(song, { signal })` asks the maintained SoundCloud client for a fresh final progressive stream link and
returns an HTTP(S) URL resource without mutating or caching the canonical permalink. Any required playback headers
stay on the private resource. A progressive track with finite positive duration is seekable; a missing duration or
manifest-only playback does not gain that capability.

`resolve(url, options?)` returns `Song | Playlist | undefined`: one Song for a track URL, one ordered `Playlist` for a
set, and `undefined` to decline a URL the plugin does not own. `related(song, { signal, exclude })` supplies one
autoplay candidate from SoundCloud's related-tracks lookup, skipping any track whose id appears in `exclude`, and
declines with `undefined` when the provider offers nothing usable. `suggest(query, { signal })` returns up to 25
search completions in provider order; a provider failure resolves to an empty list and records one diagnostic.

## Provider data

A Song carries its canonical identity, `name`, `artist`, `duration` in seconds, and `thumbnail`. Artwork falls back
to the uploader avatar when a track has no artwork. Provider display data lives in the typed `pluginData` slot:
`SoundCloudData` holds `plays`, `likes` and `uploader`. A Playlist carries collection artwork when available and its
`pluginData` is `SoundCloudPlaylistData` with the set owner as `uploader`.

Failures the provider distinguishes reject with a `DisTubeError` carrying a `SoundCloudErrorCode`:
`SOUNDCLOUD_NOT_FOUND` (HTTP 404), `SOUNDCLOUD_UNAVAILABLE` (blocked or non-streamable track, HTTP 403) and
`SOUNDCLOUD_RATE_LIMITED` (HTTP 429). Any other failure stays a generic provider error that core maps to
`SOURCE_FAILED`.

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit`, and a zero-based `offset`. The default
limit is **10** and the maximum is **50**, with `offset` up to 1000; the window maps onto the search endpoint's
`limit`/`offset` parameters, so consecutive windows are disjoint in provider order. A window past the available
results returns an empty list; an out-of-range `limit` or `offset` rejects with `INVALID_ARGUMENT` before any request.

Preparation fails rather than handing a Player a page URL: if stream-link acquisition yields no media URL, or yields
the track's own permalink, the item fails with `SOURCE_FAILED`.

`SoundCloudPluginOptions.network` configures request timeout, streamed byte, redirect, and explicit
trusted-private-host limits. Accepted page URLs and final sndcdn stream URLs are host/address validated, cancellation
propagates through resolve/search/preparation, and sensitive URLs are redacted. An injected `SoundCloudProvider` must
honor AbortSignals and disposal, preserve ordered results, return SoundCloud-owned Songs, and return a fresh safe final
stream URL.
