---
title: Lavalink
description: Configure remote playback and source lookup with @distube/lavalink.
---

`@distube/lavalink` is a source plugin and playback engine over a pool of Lavalink v4.2 or later v4 nodes.

## Install

Install alongside `distube` and your adapter. This example also uses SoundCloud:

```sh
bun add @distube/lavalink @distube/soundcloud
```

## Example

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { LavalinkPlugin } from "@distube/lavalink";
import { SoundCloudPlugin } from "@distube/soundcloud";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [
    new SoundCloudPlugin(),
    new LavalinkPlugin({
      nodes: [{ host: "127.0.0.1", port: 2333, password: "youshallnotpass" }],
    }),
  ],
});

await distube.play(voiceChannel, "a song title");
```

Lavalink's engine replaces the built-in engine just by appearing in `plugins`. Source plugins still resolve and
search in array order. Put Lavalink last to let dedicated sources own their providers, or first to let nodes
resolve URLs before those sources. Lavalink alone is enough when the node can load all your inputs.
Remote playback needs no local decoder.

## Preparation order

For every Song, Lavalink tries these steps and stops at the first loaded track:

1. Load the canonical page URL with `loadtracks(song.url)`.
2. If that fails and the owning plugin has `stream`, call it. If it returns a `url` resource with no headers, load its URL
   through the node's `http` source. Enable the `http` source in the Lavalink server's `application.yml` for this step.
3. Search for `<searchPrefix>:<name> <artist>` and take the first hit.

Native loading does not call the source's `stream`. YouTube's process-local resources cannot be sent to a node,
but its Songs can still play through native loading or the search step. If all steps fail, preparation rejects
`SOURCE_FAILED` with an `AggregateError` containing the step failures.

## Options

`LavalinkPluginOptions` has one required field and six optional fields:

- `nodes` is a non-empty list. Each node needs `host` and `password`; `port` defaults to 2333. Use `secure` for TLS
  and `identifier` to name the node in diagnostics. The client user ID comes from the adapter's voice session.
- `searchPrefix` defaults to `ytsearch`. Enable the corresponding search source on the server.
- `reconnect` configures `retries`, `backoffMs` and `maxBackoffMs`. Defaults are unlimited retries, 1000 ms initial
  backoff and a 30000 ms ceiling, with jitter.
- `resume.timeoutSeconds` defaults to 60; 0 disables session resume.
- `failover` defaults to `"migrate"`, which resumes on another ready node with position and audio settings intact.
  `"fail"`, or no remaining node, rejects active playback with `VOICE_FAILED`.
- `filters` adds or overrides native Lavalink filter presets.
- `onDiagnostic` receives node failures, reconnects, resumes and migrations. The plugin writes nothing to process output.

## Playback controls and errors

New Players use the least-loaded ready compatible node. Playback rejects `VOICE_FAILED` when no node is available.
Only presets with a native Lavalink equivalent are built in. The Player has no bitrate control, so numeric
`voice.setBitrate(...)` on an active Lavalink voice rejects `UNSUPPORTED`.

Preparation returns `encoded` resources with format `lavalink.v4`. Direct playback through a Lavalink voice rejects
other resource kinds or encoded formats with `UNSUPPORTED`; it never uploads or proxies media.
Plugin failures are core `DisTubeError` instances with `error.source` set to `"lavalink"`.

See [installation](../guides/installation/), [queue and voice controls](../guides/guide/) and
[error handling](../guides/error-handling/).
