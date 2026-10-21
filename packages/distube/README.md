# distube

DisTube plays music in Discord voice channels. An Adapter connects a platform library, SourcePlugins resolve
media, and the client hands you two owners per guild: a `DisTubeVoice` for the connection and a `DisTubeQueue`
that schedules tracks through it.

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceBasedChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceBasedChannel;
declare const anotherChannel: VoiceBasedChannel; // same guild

const youtube = new YouTubePlugin();
const distube = new DisTube<{ requestedBy: string }>({
  adapter: new DiscordJSAdapter(client),
  sources: [youtube],
});

const unsubscribe = distube.on("queue.item.started", ({ item }) => {
  console.log(item.song.name, item.song.formattedDuration, item.metadata?.requestedBy);
});

const queue = await distube.play(voiceChannel, "never gonna give you up", {
  metadata: { requestedBy: "user-id" },
});
console.log(queue.current?.song.name, queue.upcoming.length);

// When the bot shuts down:
unsubscribe();
await distube.dispose();
```

`play` validates its input, registers the guild's queue synchronously, then resolves media, joins or reuses the
voice and inserts. It resolves with the exact queue once insertion commits.
Read exact occurrences from `queue.item.added` or `queue.playlist.added` events. Playback starts later and reports
through events. `distube.getQueue(guildId)` returns the queue as soon as `play` has been called, so a command
handler can read it while resolution is still running.

Options: `adapter` (required), `sources` (required, searched in order), `engine` (uses the adapter default when one exists; otherwise required),
`historySize` (integer, default 10) and `onDiagnostic` for structured diagnostics.

## DisTubeQueue

A queue is a scheduler over one voice. It owns `current`, `upcoming`, `history`, `status` (`idle`, `playing`,
`paused`), `repeat`, `autoplay` and reads `position` from the voice. Get one from `play` or `getQueue(guildId)`;
`distube.queues` iterates the live ones. `queue.voice` is the exact attached voice, or `undefined`
before attachment and immediately after detachment. An old queue never exposes a replacement voice.

```ts
const queue = distube.getQueue(voiceChannel.guildId);
if (!queue) throw new Error("nothing playing");

await queue.add("https://youtu.be/example", { next: true }); // play next
await queue.add("lofi beats", { at: 2, metadata: { requestedBy: "user-id" } }); // zero-based position
await queue.jump(2); // one-based position in upcoming
await queue.jump(queue.upcoming[0]!.id, { requeue: true }); // by item ID, skipped items go to the tail
await queue.previous(); // replays the newest history Song
await queue.shuffle();
await queue.remove(2); // one-based position
await queue.remove({ from: 1, to: 3 }); // inclusive one-based range
await queue.remove(queue.upcoming[0]!.id); // by item ID
await queue.move(queue.upcoming[1]!.id, queue.upcoming[0]!.id); // before another item, omit to move to the tail
await queue.clear(); // empties upcoming, current keeps playing
await queue.skip();
await queue.pause();
await queue.resume();
await queue.seek(60);
await queue.setRepeat("queue"); // "off" | "song" | "queue"
await queue.setAutoplay(true);
const related = await queue.addRelated(); // one related occurrence appended to the tail
console.log(queue.history.at(-1)?.song.name, related.song.name);
await queue.stop(); // deletes the queue, the voice stays connected
```

Positions are evaluated when the edit commits, so `remove(3)` cannot delete the wrong item when another insert
lands first. Malformed targets reject `INVALID_ARGUMENT`; an ID or position that is no longer waiting rejects
`INVALID_STATE`. `jump` without `requeue` sends the current item and everything before the target to history.
`previous` needs a non-empty history and puts the current item back at the front of `upcoming`.

`history` keeps the most recently finished, skipped or jumped-over items, newest last, bounded by `historySize`.
Failed items never enter it, and it is cleared when the queue is deleted. Autoplay passes history Songs to the
owning source so it avoids repeats. Repeat and autoplay die with the queue; a later queue for the guild starts
with repeat off and autoplay false.

Exhaustion deletes the queue after `queue.finished`. Commands on a deleted queue reject `INVALID_STATE`.

## DisTubeVoice

A voice is the guild's connection plus the audio settings that live as long as it does. Join one directly, or
let `play` create it.

```ts
const voice = await distube.voices.join(voiceChannel, { selfDeaf: false, selfMute: false });
await voice.setVolume(60); // 0 to 100, default 100
await voice.setSelfDeaf(true);
await voice.setSelfMute(false);
await voice.move(anotherChannel);
console.log(voice.channelId, voice.volume, voice.selfDeaf, voice.selfMute, voice.position);

// Direct playback without a queue, for example a sound effect:
await voice.play({ kind: "url", url: "https://cdn.example/airhorn.mp3", seekable: true });
await voice.pause();
await voice.resume();
await voice.seek(2); // requires an active seekable resource and engine support
await voice.stop();

await voice.leave(); // same as distube.voices.leave(guildId); drops volume, filters, self-deaf and self-mute
```

Join defaults are self-deaf on and self-mute off, the same defaults `play` uses. Volume, filters, self-deaf and
self-mute survive queue stop and exhaustion and disappear when the voice leaves. `voice.leave()` and
`distube.voices.leave(guildId)` are the same operation: any attached queue is fenced and deleted first, then the
Player and the session are released, and `voice.disconnected` publishes once with reason `left`. Both are
idempotent, and `voice.leave()` on a stale handle whose guild already has a newer voice is a no-op.

While a queue is attached to the voice, `voice.play`, `stop`, `pause`, `resume` and `seek` reject `INVALID_STATE`.
Use the queue's controls instead, so `queue.status` stays truthful. `queue.stop()` detaches synchronously, after
which the voice accepts direct track controls again. Volume, filters, self-deaf and self-mute stay callable on the
voice at any time.

Direct playback accepts a `PlaybackResource` whose `kind` the engine declares in `engine.accepts`. The official
local engines accept `url`, `file` and `stream`; Lavalink accepts `encoded` with format `lavalink.v4`,
and headerless URLs only with `trustedUrlLoading: true`. Pass `{ itemId }` to correlate the track's
`voice.track.*` events with your own identity.

### Filters

`voice.filters` is a manager over an ordered set of engine presets. Each mutation renders once through the backend
and commits only after acknowledgement; a failed render keeps the previous set.

```ts
await voice.filters.set("bassboost", 15); // ranged preset with a value, clamped to its range
await voice.filters.set("nightcore"); // omitted value uses the preset default
await voice.filters.toggle("earwax"); // removes when selected, otherwise sets
await voice.filters.remove("nightcore");
console.log(voice.filters.has("bassboost"), voice.filters.names);
for (const entry of voice.filters.entries) console.log(entry.name, entry.value, entry.label); // "Bass +15dB"
await voice.filters.clear();
```

`voice.filters.definitions` maps each preset name to `{ default, min, max, acceptsValue, label(value?) }`, which
is what a slash command needs to build its choices and validate a value:

```ts
const choices = [...voice.filters.definitions].map(([name, info]) => ({
  name: info.label(),
  value: name,
  ranged: info.acceptsValue,
}));
```

Unknown presets reject `UNSUPPORTED`. A value on a fixed preset rejects `INVALID_ARGUMENT`. Setting an already
selected name replaces its value in place and keeps the order. Presets and their ranges belong to the engine;
adapters accept custom definitions at construction. Filters persist across queue deletion. If you want them
cleared when a queue ends, call `voice.filters.clear()` from a `queue.deleted` listener.

## Search and suggestions

```ts
const songs = await distube.search("lofi", { source: youtube, limit: 5 }); // Song<YouTubeData>[]
console.log(songs[0]?.pluginData.views, songs[0]?.pluginData.uploader);

const anySource = await distube.search("lofi"); // first non-empty source in configured order, Song[]
const completions = await distube.getSuggestions("lo", youtube); // string[]
```

`source` must be a plugin instance configured on this client, otherwise the call rejects `INVALID_ARGUMENT`. With
`source` the results are typed by that plugin's declared `PluginData`. Without it the return type is `Song[]` and
`pluginData` is `unknown`. `getSuggestions` uses the optional `suggest` member; a source without it declines.
Both calls accept `signal`, create no queue or voice, and reject `INVALID_STATE` once the client is disposing.

`distube.resolve(input, { signal })` returns a `Song` or `Playlist` without touching queue or voice state. A query
that every source declines rejects `NO_RESULT`.

## Songs, playlists and queue items

`Song` has `source`, `id`, `name`, `url`, optional `duration` (seconds), `thumbnail` and `artist`, and a
`pluginData` slot the owning plugin fills and core never reads. `formattedDuration` renders `h:mm:ss` above an
hour, otherwise `m:ss`, and `Live` when the duration is unknown or zero. `Playlist` has `id`, `name`, `url`,
`source`, `songs`, optional `thumbnail`, `pluginData`, and `duration` plus `formattedDuration` summed over its
Songs.

`QueueItem` is one occurrence of a Song in a queue: `id`, `song`, `addedAt` and the caller-owned `metadata`
reference. Core stores metadata without reading, copying or freezing it. Type it with `new DisTube<Metadata>()`.

## Errors

Every public failure is a `DisTubeError` with a string `code`, a message and an optional `cause`. Core codes live
on the `ErrorCode` object; plugins export their own prefixed codes. Core preserves safe plugin errors and
sanitizes unsafe messages or nested causes while keeping the code.

```ts
import { DisTubeError, ErrorCode } from "distube";
import { YouTubeErrorCode } from "@distube/youtube";

async function playCommand(input: string): Promise<void> {
  try {
    await distube.play(voiceChannel, input);
  } catch (error) {
    if (DisTubeError.is(error, YouTubeErrorCode.AGE_RESTRICTED)) return reply("That video is age restricted.");
    if (DisTubeError.is(error, ErrorCode.NO_RESULT)) return reply("Nothing found.");
    if (DisTubeError.is(error, ErrorCode.ABORTED)) return;
    throw error;
  }
}
```

| Code               | Meaning                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT` | Malformed input or configuration                                                                                                                   |
| `INVALID_STATE`    | A valid operation the current state forbids: a deleted queue, a released voice, direct voice playback while a queue is attached, a disposed client |
| `ABORTED`          | The caller's signal aborted before commit                                                                                                          |
| `NO_RESULT`        | Every consulted source declined the query                                                                                                          |
| `SOURCE_FAILED`    | A provider failed with a non-DisTube error                                                                                                         |
| `VOICE_FAILED`     | The connection or backend effect failed                                                                                                            |
| `PLUGIN_FAILED`    | Integration initialization or disposal failed                                                                                                      |
| `QUEUE_FAILED`     | Queue decision logic failed                                                                                                                        |
| `UNSUPPORTED`      | The engine cannot do it: an undeclared resource kind, an unknown filter, seek on an engine without it                                              |

`DisTubeError.is(error, code)` narrows to `DisTubeError<typeof code>`. A `switch` on `error.code` needs a default
branch because plugin codes are open strings.

## Events

`distube.on(name, listener)` returns an unsubscribe function. Listeners run after the producing commit, in order
per guild. Throws and rejections are isolated and reported through `onDiagnostic`.

| Event                   | Payload beyond `guildId`, `timestamp`                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| `queue.created`         | `queue`, `state`                                                                  |
| `queue.item.added`      | `queue`, `state`, `item`                                                          |
| `queue.playlist.added`  | `queue`, `state`, `playlist`, `items`                                             |
| `queue.item.started`    | `queue`, `state`, `item`                                                          |
| `queue.item.finished`   | `queue`, `state`, `item`                                                          |
| `queue.item.failed`     | `queue`, `state`, `item`, `error`                                                 |
| `queue.history.added`   | `queue`, `state`, `item`                                                          |
| `queue.finished`        | `queue`, `state`; the queue deletes itself next                                   |
| `queue.autoplay.failed` | `queue`, `state`, `song`, `error`                                                 |
| `queue.deleted`         | `queue`, `state`                                                                  |
| `voice.track.started`   | `voice`, optional `itemId`                                                        |
| `voice.track.finished`  | `voice`, optional `itemId`                                                        |
| `voice.track.failed`    | `voice`, optional `itemId`, `error`                                               |
| `voice.disconnected`    | `voice`, `channelId`, `reason` (`left`, `platform`, `shutdown`), optional `error` |

Queue events capture `state` (`current`, `upcoming`, `history`, `status`, `repeat`, `autoplay`) as of the commit.
Voice track events publish for direct and scheduled playback alike and precede the derived `queue.item.*` event
for the same item. A direct `voice.play` publishes only voice track events.

## Writing a plugin

Author contracts are type-only imports from `distube/integrations`. A `SourcePlugin<PluginData>` needs `name`, `stream(song, context)` and at least one
of `resolve(url, options?)` or `search(query, options?)`. Construction checks this discovery requirement.
`related`, `suggest`, `initialize` and `dispose` are independently optional. Constructors validate options only; provider requests start on
first use.

```ts
import type { PlaybackContext, PlaybackPreparation, SourcePlugin } from "distube/integrations";
import { Song } from "distube";

interface ExampleData {
  readonly plays: number;
}

class ExampleSource implements SourcePlugin<ExampleData> {
  readonly name = "example";
  async resolve(url: string): Promise<Song<ExampleData> | undefined> {
    if (!url.startsWith("https://example.audio/")) return undefined;
    return new Song({ source: this.name, id: "1", name: "Track", url, duration: 245, pluginData: { plays: 9 } });
  }
  async stream(song: Song<ExampleData>, context: PlaybackContext): Promise<PlaybackPreparation> {
    context.signal.throwIfAborted();
    return { kind: "resource", resource: { kind: "url", url: `https://cdn.example/${song.id}` } };
  }
}
```

`resolve` returns `undefined` to decline a URL. `search` returns an empty list to decline a query and must honour
its documented `limit` and `offset` bounds. `stream` returns a fresh single-use resource, or `{ kind: "search",
query }` for a metadata-only source that plays through another one. Throw `DisTubeError` with your own
upper-case prefixed codes so bots can narrow them. See the [plugin](https://distube.js.org/distube/guides/plugin-authoring/) and [adapter](https://distube.js.org/distube/guides/adapter-authoring/) authoring guides for the full
contract.

## Files, streams and authenticated URLs

For sound effects or generated audio, use direct `voice.play` with a fresh resource. Local engines accept
absolute files, Node readable streams and progressive HTTP(S) URLs with optional headers. Read
`voice.capabilities` for engine support and `voice.seekable` for the active track. Streams cannot seek; URL seeks
reopen the request and decode/discard to the offset. Each resource and readable is single-use, even after a
later compatibility rejection. See [direct inputs](https://distube.js.org/distube/guides/direct-inputs/) for copyable examples and cleanup rules.
