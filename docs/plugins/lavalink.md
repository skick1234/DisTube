---
title: Lavalink
description: "Install and configure @distube/lavalink, covering node pool, balancing, failover, filters and Lavalink v4.2+ requirements."
---

Official Lavalink `SourcePlugin` and playback `Engine` for DisTube v6.

Install the package next to `distube`:

```sh
bun add @distube/lavalink
```

```ts
import { LavalinkPlugin } from "@distube/lavalink";
import { DisTube } from "distube";
import type { Adapter } from "distube/integrations";

declare const adapter: Adapter;

const lavalink = new LavalinkPlugin({
  nodes: [{ host: "127.0.0.1", port: 2333, password: "youshallnotpass" }],
});

const distube = new DisTube({ adapter, sources: [lavalink], engine: lavalink });
```

One `LavalinkPlugin` instance is both roles at once, over one shared pool of nodes: it resolves and searches through
`/v4/loadtracks`, and it creates the `Player` that plays the result. Because both sides borrow from the same pool, a
track always plays on a node that can already load it. There is no separate engine package, no per-node class to
construct, and no registry to register with.

## Node configuration

`nodes` is the pool. A single-node deployment is a one-element array. The number of entries determines the pool size.
Each entry needs `host` and `password`; `port` defaults to `2333`, `secure` selects `https`/`wss`, and `identifier`
names the node in diagnostics, defaulting to its array position. The plugin reads the connected client's user ID
from `VoiceSession.clientUserId` before opening a Lavalink session. The former `userId` option is rejected.
The adapter supplies gateway membership only; Lavalink playback needs no local codec or FFmpeg.
`searchPrefix` chooses the search source and defaults to `ytsearch`.

The plugin checks each node's REST compatibility during initialization. It defers the v4 WebSocket session until it has
an identity from a `VoiceSession`, but source resolution can run before a voice session exists.

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit`, and a zero-based `offset`. The default
limit is **10** and the maximum is **100**, with `offset` up to 1000; the node returns one ranked page per search and
the window slices it locally, so consecutive windows are disjoint in the node's ranking order. A window past the
available results returns an empty list; an out-of-range `limit` or `offset` rejects with `INVALID_ARGUMENT` before
any node request.

## Balancing, reconnect and failover

`loadBalancing` picks the node for a new `Player`. `least-load` (default) ranks ready nodes by the standard Lavalink
client penalty from each node's `stats` frame, lower is better:

```text
penalty = playingPlayers
        + 1.05 ^ (100 * cpu.systemLoad) * 10 - 10
        + 1.03 ^ (500 * frameStats.deficit / 3000) * 600 - 600
        + (1.03 ^ (500 * frameStats.nulled / 3000) * 300 - 300) * 2
```

The frame terms are zero while a node reports no `frameStats`. Nodes that have not sent a `stats` frame yet are only
picked when no candidate has one. `least-players` ranks by `playingPlayers` alone. `round-robin` cycles. A node entry may carry `region` (`rotterdam`,
`us-east`); when the guild's voice endpoint starts with that region, matching nodes are considered first. If every
node is down, the pool retries the whole set once per borrow, so a node that comes back is usable again without
restarting the client; only a genuinely exhausted pool rejects.

Each node runs one connection state machine: connecting, ready, reconnecting, closed. On session open the plugin
configures v4 resuming with `resume.timeoutSeconds` (default 60; `0` disables it). When the socket drops, the node
reconnects with exponential backoff for `reconnect.retries` attempts (unlimited by default). The delay before retry
`n` (from 0) is `min(maxBackoffMs, min(maxBackoffMs, backoffMs * 2^n) * (1 + random * 0.25))`, so with the defaults
the first wait is 1000 to 1250 ms and no wait exceeds 30000 ms. A borrow while a retry is pending runs it at once. A reconnect the node answers with
`resumed: true` keeps every `Player` playing; REST controls keep flowing to the dropped session inside the window.

`failover` decides what happens once the session is lost, either because the resume window expired, the node came
back with a fresh session, or retries ran out. `migrate` (default) recreates each affected `Player` on the best
remaining node in one `PATCH`: voice credentials, the encoded track at its last reported position, pause state, volume
and filters. The same `Player` object continues and reports no failed outcome; expect a skip of up to one position
report. `fail` reports one terminal failed outcome for the active item instead, as does `migrate` when no node
remains.

## Plugin ordering

Plugins are consulted in array order. `resolve` returns `undefined` for unsupported or empty results, while a node load
error rejects with `SOURCE_FAILED`. Where Lavalink sits in `sources` therefore decides who owns a URL. Listing it last
leaves the dedicated source plugins in charge of their own providers and lets Lavalink absorb everything they decline:

```ts
import { LavalinkPlugin } from "@distube/lavalink";
import { DisTube } from "distube";
import type { Adapter, SourcePlugin } from "distube/integrations";

declare const adapter: Adapter;
declare const youtube: SourcePlugin;
declare const soundcloud: SourcePlugin;

const lavalink = new LavalinkPlugin({
  nodes: [{ host: "lavalink.internal", password: "node-password" }],
});
const distube = new DisTube({ adapter, sources: [youtube, soundcloud, lavalink], engine: lavalink });
```

Listing it first hands every supported URL to the nodes instead, including ones a dedicated plugin would otherwise
handle. Either arrangement is supported. The explicit `engine: lavalink` selects remote playback independently
of source ordering. Core initializes and disposes the shared instance once.

## Requirements

Lavalink **v4.2 and later within major 4** only. Older v4 and other major versions are rejected. Each node's `/v4/info` is checked before its session socket opens. If that route returns `404`,
the plugin requests `/version` so its diagnostic names the server's reported protocol version and the supported version.
A valid `/v4/info` response is required; `/version` is only used to explain an incompatible server.

The package has no runtime dependencies: it speaks v4 over the platform `fetch` and `WebSocket`, so it needs a runtime
that provides both. `LavalinkPluginOptions.transport` is a typed seam over exactly those two clients, which is how the
package's own suite drives a complete fake v4 node in process. It is an advanced injection point, not a place to add
retry or caching policy.

`trustedUrlLoading` governs exactly one thing: whether a `url` resource prepared by _another_ SourcePlugin may reach a
node. It is off by default, it is never consulted for an `encoded` resource, and nothing this plugin resolves or
prepares needs it. Turn it on only for nodes whose operators enforce the same public-destination, redirect, response,
deadline, and credential policy as the source plugins do. A password alone does not make a node safe for loading
arbitrary URLs.

`stream` reloads the Song through the node pool and returns a fresh `encoded` resource with format `lavalink.v4`.
Its `seekable` flag is true only for seekable, non-live content with finite positive duration.
Files, Node streams, foreign encoded formats and URLs with headers reject with `UNSUPPORTED` before playback node I/O.
Only header-free HTTP(S) URLs can use `trustedUrlLoading`. The engine's synchronous `supportsResource` check declines
incompatible resource options before core creates a Player, so source fallback can try another candidate. An empty
headers object has no headers and is accepted. Direct Player callers receive the same restrictions from `play`.

Every start, move, gateway refresh, resume and migration uses one complete voice snapshot containing
`channelId`, `sessionId`, `token` and `endpoint`. A resumed player refreshes credentials without restarting its track. A default
`new LavalinkPlugin({ nodes })` resolves before a `VoiceSession` exists, then opens the session when playback creates a
Player. The plugin implements no `related`; autoplay stays with the source plugins that own their providers.

Every Song the plugin returns carries `pluginData: LavalinkData` with the node's `sourceName`, `isSeekable` and
`isStream`. The engine reports `capabilities.seek: true`.

## Errors

Failures the node distinguishes are thrown as `DisTubeError` with a `LavalinkErrorCode`, narrowed through
`DisTubeError.is(error, LavalinkErrorCode.NO_MATCH)`:

| Code                      | When                                                                        |
| ------------------------- | --------------------------------------------------------------------------- |
| `LAVALINK_NO_MATCH`       | `stream` found nothing playable for the Song's URL.                         |
| `LAVALINK_LOAD_FAILED`    | The node answered a load with its `error` result.                           |
| `LAVALINK_POOL_EXHAUSTED` | No node is ready for a load or a Player, after one retry of the whole pool. |

Everything else keeps core's codes: `INVALID_ARGUMENT` for bad input, `UNSUPPORTED` for a resource kind or filter
the node cannot take, `VOICE_FAILED` for a failed player update or a retired Player.

## Filters

`filters` (the `Engine.filters` map) reports the full native v4 filter vocabulary (`volume`, `equalizer`, `timescale`,
`vibrato`, `rotation`, `distortion`, `channelMix`, `lowPass`) plus the conventional named presets a stock node can
render natively. Each entry is a `FilterDefinitionInfo`: `default`, `min`, `max`, `acceptsValue` and `label(value?)`.
The adjustable presets use the same ranges and labels as the voice engine, so a command built from the map behaves
the same on either backend: `bassboost` is 0 to 20 dB (default 10, `Bass +10dB`), `nightcore` a rate of 1 to 2
(default 1.25, `Nightcore x1.25`), `vaporwave` a rate of 0.5 to 1 (default 0.8). `3d`, `earwax`, `haas`, `karaoke`,
`surround` and `tremolo` are fixed and labelled by name. A value outside a range is clamped; a value on a fixed
preset rejects with `INVALID_ARGUMENT`.

Six conventional presets are **not** among them: `echo`, `flanger`, `gate`, `mcompand`, `phaser`, and `reverse`. Each
needs a server-side Lavalink filter plugin, and a node without one would accept the request and then play the track
unchanged. Applying one rejects with `UNSUPPORTED` and the name is absent from `filters`. For the same reason there
is no bare `pluginFilters` preset. If your nodes do run such a plugin, define the payload yourself and the name joins
the map:

```ts
import { LavalinkPlugin } from "@distube/lavalink";

const lavalink = new LavalinkPlugin({
  nodes: [{ host: "lavalink.internal", password: "node-password" }],
  filters: {
    echo: {
      render: (value = 0.5) => ({ pluginFilters: { echo: { delay: value, decay: 0.5 } } }),
      default: 0.5,
      min: 0,
      max: 2,
      label: value => `Echo ${value}s`,
    },
  },
});
```

A definition needs `render`; `default`, `min` and `max` make it adjustable and are validated at construction, and a
definition that renders no native filter at its default is rejected.

## Diagnostics

Every node initialization failure, selection failure, and mid-track node loss produces a diagnostic naming the node.
Connection changes are reported under `lavalink.node.connected` (with `resumed`), `lavalink.node.disconnected` and
`lavalink.node.reconnecting` (with `retry` and `delayMs`); a migration under `lavalink.player.migrated` with the
source and target node names.
That name is the `identifier` you configured; a node configured without one is named by its position in `nodes`
(`node #2`), because the `host:port` alternative would put an internal hostname into public output. Credentials,
authorization values, and query strings are stripped from diagnostics, including out of an `identifier` that contains
one. A node speaking the wrong protocol is reported as a version mismatch stating both versions, never as a generic
connection failure.
