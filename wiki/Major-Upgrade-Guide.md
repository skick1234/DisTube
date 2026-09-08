# Migrating to DisTube v6

The client keeps direct playback: `distube.play(voiceChannel, input, options?)`. There is no mandatory guild selector
or replacement player facade. The client provides `DisTubeGuild` for queue controls and `DisTubeVoice` for connection
and settings controls. These changes are breaking; removed APIs have no compatibility aliases.

## Application API changes

| Earlier API | Replacement |
| --- | --- |
| `new DisTube({ adapter, plugins })` | `new DisTube({ adapter, sources, engine? })`; source order is explicit |
| Automatic engine discovery in `plugins` | Pass the engine instance as `engine`, also in `sources` when it resolves media |
| `play({ guildId, voiceChannelId }, input)` | `play(voiceChannel, input)`; a structural target has `id` and `guildId` or `guild.id` |
| Queue factory, mandatory guild selector | Call `play`; use `getQueue(guildId)` or its returned `queue` |
| `GuildQueue`, `Voice` | `DisTubeGuild`, `DisTubeVoice`, supplied by the client |
| `queue.state.items` | `queue.state.upcoming`; the current occurrence is separate |
| Queue ID lookup | `getQueue(guildId)`; queues have `guildId`, no random public queue ID |
| Index-based removal and movement | `remove(itemId)`, `move(itemId, beforeItemId?)` for waiting occurrences |
| `jump`, `previous`, public history | Keep application history yourself; enqueue a retained Song as a fresh occurrence |
| `shuffle`, `clear`, insertion position or skip options | Compose documented occurrence operations; insertion options are `metadata` and `signal` |
| Queue settings, `voice.setRepeatMode` | `voice.setVolume`, `setRepeat`, `setAutoplay`; read `voice.settings` |
| Mutable filter manager | `voice.setFilters(names)` replaces the complete ordered set; `[]` clears it |
| Runtime `RepeatMode`, `QueueStatus`, `Filters` enums | Literal modes, statuses and supported filter names |
| `Song.title`, `Playlist.title` | `name` |
| Provider metadata, `uploader`, `isLive`, `views` on Song | Fixed public fields; provider-specific data stays private to its source |
| Mutable `queue.metadata` | Application-owned storage keyed by guild ID |
| Reassignable occurrence metadata | Readonly optional binding to caller-owned contents; use `DisTube<Metadata>` |
| `shutdown()` | `await distube.dispose()` |
| Runtime `Events` members | Typed dotted names such as `"queue.item.started"` |
| Chained `on`, `once`, `off`, `removeAllListeners` | Store the unsubscribe function returned by each `on` registration |
| `ErrorCode`, `ErrorReason`, public error helpers | `DisTubeError` with literal `code` and optional `cause` |
| Cancellation reported as `QUEUE_FAILED` | `ABORTED` for caller cancellation before commit |
| Bad-state `INVALID_ARGUMENT` with `reason` | `INVALID_STATE`; malformed values still use `INVALID_ARGUMENT` |

The root exports application values and method-facing types. Extension authors use type-only imports from
`distube/integrations`; separate SDK/testkit packages and private implementation imports remain unsupported.

## Registration and lifetime changes

`play` copies channel IDs, validates shallow input and reserves the guild's queue synchronously before returning its
promise. `getQueue` and readonly queue iteration can observe an idle empty queue immediately. Creation listeners run
after the initial invocation and first reservation. `queue.created` acknowledges registration, not successful
insertion or audible playback.

Each call retains its original queue identity. Stop unregisters and fences that queue immediately; late resolution
cannot insert into a later replacement. Failed first work deletes its empty queue only when no item, attempt or other
reservation remains. It publishes deletion without a natural-finish event and cannot release adopted voice.

Queue exhaustion still publishes `queue.finished` then `queue.deleted`. Live insertion reservations prevent premature
exhaustion. Stop and exhaustion retain the connected voice. Volume, repeat and autoplay survive queue deletion;
filters now reset on deletion, both selected names and backend rendering. Reset joins terminal cleanup. Failure
retains last acknowledged filter settings and rendering, reports the cleanup cause and cannot revive the queue.
Replacement backend effects wait for old cleanup so an old reset cannot clear newer filters.

`voices.leave(guildId)`, terminal connection loss and `dispose` end voice ownership. A later voice starts with
volume 100, repeat `"off"`, autoplay false and no filters. Commands on deleted queues or released voices reject
`INVALID_STATE`; repeated stop joins the same cleanup, and leave with nothing to clean is a no-op.

## Media and metadata

Song contains `source`, `id`, `name`, canonical `url`, optional `duration`, optional `thumbnail` and optional
`artist: string`. Playlist contains `source`, `id`, `name`, canonical `url`, optional `thumbnail` and readonly Songs.
Missing duration stays absent; do not fabricate a zero length from missing provider data. Keep signed URLs, encoded
tracks and provider-specific state private. Sources reacquire playback resources for each attempt.

Core creates each QueueItem's ID and insertion timestamp at commit. Every successful insertion or natural repeat
creates a fresh occurrence. Its optional metadata binding is readonly but the referenced caller-owned contents
remain mutable, without recursive freezing or cloning. Application-managed replay enqueues the retained Song and
metadata reference; it never revives an old occurrence identity.

## Adapter and engine authors

Import author contracts with `import type` from `distube/integrations`. Each Adapter supplies a default `engine` and
`createVoiceSession(target)`. A session exposes `guildId`, readonly `clientUserId`, live `channelId`, optional gateway
credentials, `join(channelId)`, `subscribe` and `release`. Native channel objects remain private after core copies
identity. Adapters validate voice capability and guild membership before gateway mutation.

The chosen Engine declares `accepts`, `createPlayer(session)` and `resolvable(name)`. Select an override explicitly
with `engine`; a dual-role source/engine instance goes in both fields. `name` and paired `initialize(context)` /
`dispose()` hooks are optional for engines. Supplying one hook without the other is invalid. SourcePlugin requires
its name and both hooks. Lifecycle order is sources in order, then the selected engine, deduplicated by instance;
disposal reverses that order. Bare default engines need no no-op hooks, but still cannot belong to two live clients.

Player implements `position`, `play({ itemId, resource })`, `pause`, `resume`, `stopTrack`, `seek`, `setVolume`,
`setFilters`, `subscribe` and terminal `release`. It borrows source resources; core disposes those exactly once after
Player use. Correlate outcomes to the original `itemId`, own native cleanup and never inspect Song or QueueItem.
Queue deletion clears filters without terminally releasing a still-connected Player. Unsupported capabilities reject
`UNSUPPORTED` without partial application.

Keep the platform peer boundaries documented by the adapter packages:

- `@distube/discordjs`: discord.js 14.26 or newer within major 14, with `@discordjs/voice` 0.19.x.
- `@distube/oceanic`: Oceanic 1.14 or newer within major 1, with `@discordjs/voice` 0.19.x.
- `@distube/eris`: Eris 0.18.x, an Opus implementation and FFmpeg for transcoding; native seek is unsupported.

## Source authors and provider safety

Retain cancellable `search`, `resolve`, `preparePlayback` and optional `related` for autoplay. Empty search queries
reject `INVALID_ARGUMENT`. A valid query may return an empty list to decline. Resolve returns a Song, Playlist or
undefined to decline; malformed provider results reject `SOURCE_FAILED` with the validation failure preserved as
cause. Integration initialization and disposal failures still use `PLUGIN_FAILED`; malformed constructor options
use `INVALID_ARGUMENT`. Validate ownership with `song.source === name`.

Preparation returns a fresh disposable URL/encoded resource or an explicit non-empty provider-derived search query.
Core keeps original media public during bounded fallback and never silently retries an unexplained source or Player
failure. Keep provider authentication, request limits, pagination, destination/redirect/body/final-URL validation,
redaction and cleanup policies intact. Custom injected providers must pass the same checks as default providers.
Lavalink URL playback still requires `trustedUrlLoading: true` and equivalent node-side destination/redirect policy;
`accepts` must accurately describe that configuration.

Maintained source packages are `@distube/youtube`, `@distube/spotify` and `@distube/soundcloud`; `@distube/lavalink`
provides the explicit remote source/engine option. See the package READMEs for provider bounds and native dependencies.
