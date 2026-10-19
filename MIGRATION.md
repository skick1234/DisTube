# Migrating to this release

This release changes each published package's public contract. Removed APIs have no aliases. Start a music command
with `const queue = await distube.play(voiceChannel, input)`. `DisTubeQueue` schedules `current`, `upcoming`,
`history`, `repeat` and `autoplay`. Its optional `queue.voice` is the exact attached `DisTubeVoice`, which owns the
connection, Player, volume, filters, self-deaf and self-mute. A voice can also play a track on its own.

Two audiences are covered below. Pick the table for the version you are on, then read the author sections if you
maintain a plugin or an adapter.

## From v5

| v5 | This release |
| --- | --- |
| `new DisTube(client, { plugins: [new YouTubePlugin()] })` | `new DisTube({ adapter: new DiscordJSAdapter(client), sources: [new YouTubePlugin()] })` |
| `distube.play(voiceChannel, song, { member, textChannel, message })` | `const queue = await distube.play(voiceChannel, input, { metadata: { requestedBy: member.id } })` |
| `queue.songs[0]` | `queue.current?.song` |
| `queue.songs.slice(1)` | `queue.upcoming.map(item => item.song)` |
| `queue.previousSongs` | `queue.history.map(item => item.song)` |
| `queue.jump(2)` | `await queue.jump(2)` (one-based position in `upcoming`, or an item ID) |
| `queue.previous()` | `await queue.previous()` |
| `queue.shuffle()` | `await queue.shuffle()` |
| `queue.songs.splice(index, 1)` | `await queue.remove(index)` or `await queue.remove({ from: 2, to: 4 })` |
| `queue.addRelatedSong()` | `await queue.addRelated()` |
| `distube.play(channel, song, { position: 1 })` | `await queue.add(input, { next: true })` or `{ at: 0 }` |
| `queue.filters.add("bassboost")` | `await voice.filters.set("bassboost", 15)` |
| `queue.filters.remove("bassboost")` | `await voice.filters.remove("bassboost")` |
| `queue.filters.clear()` | `await voice.filters.clear()` |
| `queue.filters.names` | `voice.filters.names` |
| `queue.setVolume(50)` | `await voice.setVolume(50)` |
| `queue.volume` | `voice.volume` |
| `queue.setRepeatMode(RepeatMode.SONG)` | `await queue.setRepeat("song")` |
| `queue.repeatMode` | `queue.repeat` |
| `queue.toggleAutoplay()` | `await queue.setAutoplay(!queue.autoplay)` |
| `queue.currentTime` | `queue.position` |
| `queue.paused`, `queue.playing` | `queue.status === "paused"`, `queue.status === "playing"` |
| `song.views` | `song.pluginData.views` (typed when the Song came from `distube.search(q, { source: youtube })`) |
| `song.uploader.name` | `song.pluginData.uploader` |
| `song.isLive` | `song.pluginData.live` |
| `song.formattedDuration` | `song.formattedDuration` (unchanged; `Live` when the duration is unknown) |
| `distube.search(query, { limit, type })` | `await distube.search(query, { source: youtube, limit })` |
| `distube.on(Events.PLAY_SONG, (queue, song) => ...)` | `distube.on("queue.item.started", ({ queue, item }) => ...)` |
| `distube.on(Events.ADD_SONG, ...)` | `distube.on("queue.item.added", ({ item }) => ...)` |
| `distube.on(Events.FINISH, ...)` | `distube.on("queue.finished", ({ queue }) => ...)` |
| `distube.on(Events.ERROR, (channel, error) => ...)` | `catch` the rejection of `play`, plus `distube.on("queue.item.failed", ({ error }) => ...)` |
| `queue.textChannel` | `textChannels.set(queue.guildId, channel)` in your own `Map` |
| `distube.voices.join(channel)` | `await distube.voices.join(channel, { selfDeaf: true, selfMute: false })` |
| `voice.setSelfDeaf(true)` | `await voice.setSelfDeaf(true)` (voice from `distube.voices.get(guildId)`) |
| `error.errorCode === "SPOTIFY_NOT_FOUND"` | `DisTubeError.is(error, SpotifyErrorCode.NOT_FOUND)` |
| `leaveOnEmpty`, `leaveOnFinish` options | `distube.on("queue.finished", ({ guildId }) => distube.voices.leave(guildId))` |
| `queue.voice.leave()`, `distube.voices.leave(guildId)` | `await voice.leave()` or `await distube.voices.leave(guildId)`; both delete an attached queue first |

Use `const voice = queue.voice` when the queue is attached. It becomes `undefined` before attachment and after
detachment. A retained queue never points at a later voice for that guild. `distube.voices.get(queue.guildId)` is
still available for independent voice lookup. Every queue command returns a promise that settles after the edit
commits. Insertion `at` is zero-based; numeric `jump` and `remove` positions are one-based. Positional edits resolve
at commit time, so a concurrent insert cannot make `remove(3)` delete the wrong item.

## From the v6 pre-release

| v6 pre-release | This release |
| --- | --- |
| `DisTubeGuild` | `DisTubeQueue` |
| `queue.enqueue(input, options)` | `await queue.add(input, { metadata, signal, next, at })` |
| `const { queue, items } = await distube.play(channel, input)` | `const queue = await distube.play(channel, input)`; read exact occurrences from committed addition events |
| Guild lookup for an attached voice | `queue.voice`, optional and bound to that queue's attachment |
| `queue.state.current`, `queue.state.upcoming`, `queue.state.status` | `queue.current`, `queue.upcoming`, `queue.status` (event payloads still carry a captured `state`) |
| `GuildState` | `QueueState`, now with `history`, `repeat` and `autoplay` |
| `voice.setRepeat("song")` | `await queue.setRepeat("song")` |
| `voice.setAutoplay(true)` | `await queue.setAutoplay(true)` |
| `voice.settings.volume`, `voice.settings.repeat` | `voice.volume`, `queue.repeat` |
| `VoiceSettings` | removed; read `voice.volume`, `voice.filters`, `voice.selfDeaf`, `voice.selfMute` |
| `voice.setFilters(["bassboost", "nightcore"])` | `await voice.filters.set("bassboost", 15); await voice.filters.set("nightcore")` |
| `voice.setFilters([])` | `await voice.filters.clear()` |
| `voice.settings.filters` | `voice.filters.entries` |
| Filters cleared by `queue.stop()` | filters persist; `distube.on("queue.deleted", ({ guildId }) => distube.voices.get(guildId)?.filters.clear())` if you want the old behaviour |
| `queue.remove(itemId)` | `await queue.remove(itemId)` (unchanged) plus `remove(index)` and `remove({ from, to })` |
| no jump, previous, shuffle, clear, history | `queue.jump`, `queue.previous`, `queue.shuffle`, `queue.clear`, `queue.history` |
| `youtube.search(query, { limit })` | `await distube.search(query, { source: youtube, limit })` |
| no suggestions | `await distube.getSuggestions(query, youtube)` |
| `new ErisAdapter(client, { selfDeaf, selfMute })` | `new ErisAdapter(client)` then `distube.voices.join(channel, { selfDeaf, selfMute })` |
| no direct voice playback | `await voice.play({ kind: "url", url, dispose })` when no queue is attached |
| `distube.voices.leave(guildId)` only | `await voice.leave()` added as the same operation on the facade |
| `error.code === "SOURCE_FAILED"` for a provider miss | `DisTubeError.is(error, YouTubeErrorCode.NOT_FOUND)`; safe plugin errors retain their code and cause |
| `error.code === "SOURCE_FAILED"` for an exhausted search | `DisTubeError.is(error, ErrorCode.NO_RESULT)` |
| string literal codes only | `ErrorCode.INVALID_STATE` and friends exported as a `const` object |
| `song.duration` only | `song.formattedDuration`, `playlist.duration`, `playlist.formattedDuration` |
| `preparePlayback(song, context)` | `stream(song, context)` |
| `new DisTube({ adapter, sources, engine, onDiagnostic })` | same, plus `historySize` (default 10) |

Events gained `voice.track.started`, `voice.track.finished`, `voice.track.failed` and `queue.history.added`. Queue
payloads name their owner `queue: DisTubeQueue`. `voice.play`, `voice.stop`, `voice.pause`, `voice.resume` and
`voice.seek` reject `INVALID_STATE` while a queue is attached; use queue controls then. Existing queue controls
such as `jump`, `previous`, `shuffle`, `clear`, `remove`, `move`, repeat and autoplay remain. `queue.stop()` detaches
before it awaits cleanup.

## Plugin authors

`SourcePlugin` requires `name`, `stream(song, context)` and at least one callable discovery method, `resolve` or
`search`. Both methods are optional in the TypeScript interface so a plugin can implement just one. Core checks
the at-least-one rule at construction. `related`, `suggest`, `initialize` and `dispose` are independently optional.

Changes to make:

1. Rename `preparePlayback` to `stream`. Return a fresh `{ kind: "resource", resource }` or one
   `{ kind: "search", query }` request for bounded cross-source playback fallback.
2. Delete no-op lifecycle methods. `initialize`, if present, must finish synchronously; `dispose`, if present,
   joins owned work and releases resources. A source with only `dispose` is valid. Constructors validate options
   only; make the first provider request on first use.
3. Declare a `PluginData` type and implement `SourcePlugin<PluginData>`. Fill `pluginData` on every Song you
   construct. Core never reads it; `distube.search(q, { source: you })` types results by it.
4. Export a `const` error-code object prefixed with your upper-case name and throw `DisTubeError` with those codes
   for not-found, unavailable and rate-limited cases. Core preserves the code and a safe message/cause; it strips
   secrets from unsafe error details. A bot can write `DisTubeError.is(error, YourErrorCode.NOT_FOUND)`.
5. Implement `suggest` if the provider has an autocomplete endpoint. Return at most 25 strings; return an empty list
   to decline.
6. `related` receives `context.exclude`, the queue's history Songs. Avoid returning one of them.

```ts
import type { PlaybackContext, PlaybackPreparation, RelatedContext, SourcePlugin } from "distube/integrations";
import { DisTubeError, Song } from "distube";

export const ExampleErrorCode = { NOT_FOUND: "EXAMPLE_NOT_FOUND" } as const;

export interface ExampleData {
  readonly plays: number;
}

export class ExamplePlugin implements SourcePlugin<ExampleData> {
  readonly name = "example";
  async resolve(url: string): Promise<Song<ExampleData> | undefined> {
    if (!url.startsWith("https://example.audio/")) return undefined;
    throw new DisTubeError(ExampleErrorCode.NOT_FOUND, "Track does not exist");
  }
  async stream(song: Song<ExampleData>, context: PlaybackContext): Promise<PlaybackPreparation> {
    context.signal.throwIfAborted();
    return { kind: "resource", resource: { kind: "url", url: `https://cdn.example/${song.id}`, dispose: () => undefined } };
  }
  async related(_song: Song<ExampleData>, _context: RelatedContext): Promise<Song<ExampleData> | undefined> {
    return undefined;
  }
  async suggest(query: string): Promise<readonly string[]> {
    return [`${query} remix`];
  }
}
```

This example is resolve-only; a search-only plugin can omit `resolve`. An explicit public `search` against a
resolve-only source rejects `UNSUPPORTED`. Query discovery skips it. `@distube/plugin-network` is an optional
helper, not part of the contract.

## Adapter and engine authors

An `Adapter<Target>` now provides a synchronous, pure `normalizeTarget(target)` that returns copied
`{ guildId, channelId }` strings. Core calls it before registering a queue or joining voice. The native `Target`
type follows `DisTube<Metadata, Target>`, its queues, voices, managers and events. `createVoiceSession` receives the
normalized `VoiceTarget` and `JoinOptions` (`{ selfDeaf?, selfMute? }`). It handles gateway membership only and
does not create a local audio transport. Core defaults to self-deaf true and self-mute false unless the caller
overrides them. `adapter.engine` is optional; pass `engine` to `new DisTube` if the adapter has no default.

`VoiceSession` has readonly `selfDeaf` and `selfMute`, `join(channelId, options?)` with the same options, and
`setSelfDeaf(enabled)` and `setSelfMute(enabled)` that resolve after the gateway acknowledges the update. Its
`gateway` snapshot contains `channelId`, `sessionId`, `token` and `endpoint`. A platform rejection surfaces as a
safe `VOICE_FAILED` without native or credential data in the cause chain.

`Engine` changes:

- `resolvable(name)` is removed. Expose `readonly filters: ReadonlyMap<string, FilterDefinitionInfo>` instead; core
  calls `engine.filters.get(name)` to validate a preset and clamp its value, and `voice.filters.definitions` returns
  the same map to bots.
- `FilterDefinition` is `{ render(value?), default?, min?, max?, label? }`. A definition with none of `default`,
  `min` or `max` is fixed and takes no value. `label` is a string or a function of the value.
  `FilterDefinitionInfo` is `{ default?, min?, max?, acceptsValue, label(value?) }`.
- Add `readonly capabilities: { seek: boolean }`. Core rejects `seek` with `UNSUPPORTED` before calling the Player
  when it is false. Official local engines support files and URLs marked `seekable: true`; Node streams cannot
  seek. A Player that cannot perform a specific seek still rejects `UNSUPPORTED`.
- Declare `accepts: ReadonlySet<PlaybackResource["kind"]>`. An engine that accepts encoded input also declares a
  non-empty `encodedFormats: ReadonlySet<string>`. Core matches `resource.format` before Player work. Readonly
  map and set contracts are structural; native `Map` and `Set` instances are not required.
- If a declared kind or encoded format has option-level limits, add a pure synchronous
  `supportsResource(resource): boolean`. Core checks it after kind and format, before creating a Player. Return
  `false` for an unusable resource; core disposes an explicit fallback candidate and tries the next one. The
  method is optional for engines that accept every declared resource, and core binds it to the selected engine
  when the client is constructed.
- `FilterEntry` is `{ name, value? }`. The ad hoc `payload` field is gone; custom presets belong in the definitions
  passed at construction.

`Player` is created and released by `DisTubeVoice` alone, once per connection. Queues no longer lease it, and
queue deletion no longer calls `setFilters([])`. `stopTrack` ends a track and leaves the Player usable. The Player
borrows each source resource; core runs its optional `dispose()` after backend access ends.

```ts
import type { Engine, FilterDefinitionInfo, PlaybackResource, Player, VoiceSession } from "distube/integrations";

declare const createPlayer: (session: VoiceSession) => Promise<Player>;

const engine: Engine = {
  accepts: new Set<PlaybackResource["kind"]>(["url"]),
  capabilities: { seek: true },
  filters: new Map<string, FilterDefinitionInfo>([
    ["bassboost", { default: 10, min: 0, max: 20, acceptsValue: true, label: value => `Bass +${value ?? 10}dB` }],
  ]),
  supportsResource: resource => resource.kind === "url" && resource.headers === undefined,
  createPlayer,
};
```

The selected engine owns audio setup. An explicit remote engine can use an adapter's gateway-only session without
local FFmpeg, Opus or encryption prerequisites. This does not remove the adapter's package peer requirements.

## Direct input and resource migration

Queue inputs remain query strings, provider URLs, Songs and Playlists. A filesystem path passed to `play` is a
query. With an official local engine, join voice without a queue, or stop its queue, before submitting a direct
playback resource:

```ts
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type { DisTube, VoiceChannelTarget } from "distube";

declare const distube: DisTube;
declare const channel: VoiceChannelTarget;
declare const token: string;

const voice = await distube.voices.join(channel);
const file = resolve("clips/welcome.mp3");
await voice.play({ kind: "file", path: file });
await voice.stop();
await voice.play({
  kind: "url",
  url: "https://audio.example/private.mp3",
  headers: { Authorization: `Bearer ${token}` },
  seekable: true,
});
await voice.stop();
await voice.play({ kind: "stream", stream: createReadStream(file) });
await voice.stop();
await voice.leave();
```

The file path must be absolute. URLs use Node-controlled HTTP(S) transport with copied headers and no redirects.
Files can seek; URLs need `seekable: true` and reopen for each seek, decoding and discarding audio to the offset.
Large offsets cost time and bandwidth. Streams cannot seek or resume through a decoder restart. Read
`voice.capabilities` for engine kinds, encoded formats and seek support, then `voice.seekable` for the active track.

Every resource wrapper and every Node readable can be submitted once. A fresh, valid direct resource is consumed
before later compatibility checks; await a rejection to join its cleanup. Core ends Player access before destroying
a readable and calling optional `dispose()`, exactly once. Malformed or duplicate submissions remain caller-owned.
Provider `stream()` must likewise return a fresh resource each time. Keep paths, authentication headers, signed URLs
and encoded tracks out of public Song fields and `pluginData`.

Lavalink v4.2+ within major 4 accepts only `encoded` resources with `format: "lavalink.v4"`, plus headerless URL
loading when `trustedUrlLoading: true` and the node enforces equivalent destination policy. It rejects files,
streams, URL headers and foreign encoded formats before node work. It does not upload local files. See
[Direct playback inputs](wiki/Direct-Inputs.md) for the full cleanup and seek rules.
