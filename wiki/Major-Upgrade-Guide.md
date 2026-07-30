# Migrating from DisTube v5 to v6

DisTube v6 is intentionally breaking. There are no deprecated aliases, compatibility events, or shims.

## Bot authors

| Previous surface | v6 replacement |
| --- | --- |
| `DisTube.create(...)` or legacy constructor options | `new DisTube({ adapter, plugins, onDiagnostic? })` |
| `distube.queue(guild)` / implicit guild session | `distube.createQueue({ guildId, channelId })`, then retain its ID/facade |
| `play(...)` and `add(...)` | `queue.enqueue(source)` only |
| awaiting `play` as proof of active audio | await `enqueue` for insertion; observe `queue.item.started` or `queue.item.failed` |
| `join`, `leave`, `moveVoice` | binding at queue creation; `stop` or destroy the queue to release playback |
| `volume`, repeat, autoplay | removed from the v6 queue surface |
| queue filters and filter catalogs | removed |
| `move`, play-now replacement | removed; use waiting-item `remove`, `skip`, `stop`, and `enqueue` |
| public queue/voice snapshots | readonly `queue.state` with waiting `items`, optional `current`, and status |
| `destroy()` and `DestroyReport` | idempotent `shutdown(): Promise<void>` |

Events map as follows:

| Previous event family | v6 event |
| --- | --- |
| queue initialization | `queue.created` |
| `addSong`, `addList` | one `queue.item.added` per QueueItem |
| `songStart`, `playSong` | `queue.item.started` |
| `songFinish`, `songEnd` | `queue.item.finished` |
| queue/item playback error | `queue.item.failed` |
| finish/delete/leave lifecycle | `queue.destroyed` for explicit queue destruction |
| voice, debug, ffmpeg, snapshot events | removed; use adapter policy or `onDiagnostic` where applicable |

Errors are one `DisTubeError` with `INVALID_ARGUMENT`, `SOURCE_FAILED`, `VOICE_FAILED`, `PLUGIN_FAILED`, or
`QUEUE_FAILED`. Previous codes such as invalid-input variants, capability unsupported, aborted/superseded outcomes,
voice/plugin-specific codes, cleanup reports, and typed detail hierarchies map to the responsible one of these five or
are removed with their feature.

## Adapter authors

Remove adapter PluginClasses, definitions, manifests, roles, capability requirements, and separate voice plugins.
Implement `Adapter` directly and return a complete `Player`. Accept only queue/guild/channel IDs at the creation
boundary and only `play({ itemId, resource })` at playback. Use the prepared URL, correlate outcomes to `itemId`,
terminalize synchronously before stop teardown, own native resources, and never inspect Song/QueueItem or dispose the
borrowed source resource. There is no `play(item)` overload. GuildQueue alone owns ordering, QueueState, public events,
fallback identity, and source-resource disposal.

Official replacements:

- `@distube/discord.js` plus `@distube/djsvoice` → `@distube/discordjs`
- the former Oceanic adapter/voice composition → `@distube/oceanic`
- former Eris adapter/voice composition → `@distube/eris`
- Lavalink voice packages → no maintained v6 package; implement a future direct Adapter/Player integration

The v6 Adapter packages verify these platform peer boundaries through clean packed installs:

- `@distube/discordjs`: discord.js 14.26 or newer within major 14 and `@discordjs/voice` 0.19.x
- `@distube/oceanic`: Oceanic 1.14 or newer within major 1 and `@discordjs/voice` 0.19.x
- `@distube/eris`: Eris 0.18.x; voice needs `opusscript` or `@discordjs/opus`, plus FFmpeg for transcoding

Consumers on older platform releases must upgrade before adopting the corresponding v6 Adapter package. Eris exposes
no supported seek operation, so `queue.seek()` maps the rejected effect to `VOICE_FAILED`.

## SourcePlugin authors

Remove `@distube/plugin-sdk`, PluginClass, `define()`, PluginDefinition, manifest/contract version, roles, capabilities,
registry lookup, resource/stream leases, related/resource capability methods, and `@distube/testkit`. Export a direct
Plugin instance/class implementing `name`, synchronous `initialize`, `dispose`, cancellable `search`/`resolve`, and
required `preparePlayback(song, { signal })`. Import contracts from public `distube`, return `undefined` only when
declining URL resolution, and throw when accepted provider or preparation work fails. Return either a fresh
`{ kind: "resource", resource: { kind: "url", url, dispose } }` or an explicit trimmed
`{ kind: "search", query }`. Keep `Song.url` canonical, never store a stream/resource on Song, validate exact
`song.source === name`, and keep all tests and fixtures package-local. There is no compatibility overload, Plugin role,
fallback injection, mutable Song stream field, or public resource manager.

Provider package status:

| Previous package | v6 status |
| --- | --- |
| `@distube/youtube` | retained and rewritten as direct SourcePlugin |
| `@distube/spotify` | retained and rewritten as direct SourcePlugin |
| `@distube/soundcloud` | retained and rewritten as direct SourcePlugin |
| BandLab, Deezer, direct-link, file, HTTP, yt-dlp | not in the maintained v6 release |
| Lavalink source, search utility | not in the maintained v6 release |

## Maintainers

The DisTube repository publishes only `distube`, `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris`. The
plugins repository publishes only the three retained media plugins. The example repository consumes packed public
archives. Remove
`@distube/core`, `@distube/types`, `@distube/utils`, `@distube/plugin-sdk`, `@distube/testkit`, shared fixtures, committed
`.tgz`/`.artifacts`, and source-checkout cross-imports.

Retired public types/concepts include Playlist wrappers (collections are readonly Song arrays), Plugin Registry,
PluginClass/Definition, capability graphs/roles, SessionRegistry, GuildSession, Session Coordinator, QueueAggregate,
VoiceRuntime/PlaybackRuntime/FilterRuntime, Event Journal, Resource Manager/Scope, StreamLease, voice backends/plugins,
filters, snapshots, public schedulers/operation authorities, and cleanup reports. Keep any necessary coordination,
validation, timeout, or disposal mechanism private.

Release core first, record declarations/export maps/packed hashes, verify adapters, then install that frozen packed core
in the plugins repository. Verify each plugin archive, then build the example from all frozen archives. If the public
core contract changes, invalidate and regenerate downstream freeze evidence before continuing.
