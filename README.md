# DisTube v6

DisTube coordinates music queues and voice playback. Choose a platform adapter and media sources, then pass the
voice channel you already have to `play`. Each guild gets two owners: a `DisTubeVoice` for the connection and its
audio settings, and a `DisTubeQueue` that schedules tracks through it. The
[distube package README](packages/distube/README.md) documents every method; this page is the short tour.

## Install

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Use `OceanicAdapter` from `@distube/oceanic` for oceanic.js or `ErisAdapter` from `@distube/eris` for Eris 0.18.
Local playback needs FFmpeg, an Opus implementation and a supported encryption implementation. See
[Installation](wiki/Installation.md) for platform requirements. Local engines seek files and URLs explicitly marked seekable. One-shot streams cannot seek.

## Create and play

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

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

// During application teardown:
unsubscribe();
await distube.dispose();
```

Construction validates local configuration and initializes sources synchronously without provider requests or voice
joins. `play` copies channel identity, validates shallow input and registers its queue before returning the promise.
For an in-flight command, `const pending = distube.play(...)` then `distube.getQueue(guildId)` observes the
registered queue before `await pending`. It is idle with no items while resolution runs. `queue.created` means
registration;
it does not mean insertion or playback succeeded.

`play` resolves with the exact queue after insertion commits. Use `queue.item.added` and
`queue.playlist.added` for the exact committed occurrences. Listen for `queue.item.started` or
`queue.item.failed` for the later playback outcome. Each call keeps its original queue identity. If failed initial
work leaves no item or pending insertion, that queue is deleted without a fabricated `queue.finished` event.
Another call's queue or adopted voice is preserved.

## Resolve, search and choose sources

Absolute HTTP(S) URLs go to source resolution; other non-empty strings are queries. Sources run in configured order.
A URL is never retried as a query. Query search can continue to a later source when an earlier source fails, and a
query every source declines rejects `NO_RESULT`. `distube.resolve(input, { signal })` returns a `Song` or
`Playlist` without creating a queue or joining voice. Pass that media to `play` later, or use
`queue.add(input, { next, at, metadata, signal })` on an existing connected queue.

For a candidate list or autocomplete, pass the plugin instance you configured:

```ts
const results = await distube.search("DisTube tutorial", { source: youtube, limit: 5 }); // Song<YouTubeData>[]
const completions = await distube.getSuggestions("DisTube tut", youtube); // string[]
console.log(results[0]?.pluginData.views, completions[0]);
```

Spotify can return an explicit fallback query for playback through another configured source. The original Song and
QueueItem remain public; signed playback URLs and candidate resources remain private.

An adapter may supply a default engine. If it does not, the client needs an explicit engine. For a remote engine such as Lavalink, pass the same instance explicitly in
`sources` and `engine`. It initializes and disposes once. See [Adapter authoring](wiki/Adapter-Authoring.md).

## Control queue and voice

```ts
await queue.add("https://youtu.be/example", { next: true });
await queue.jump(2); // one-based position in upcoming, or an item ID
await queue.previous();
await queue.shuffle();
await queue.remove({ from: 1, to: 2 });
await queue.pause();
await queue.resume();
await queue.skip();
await queue.setRepeat("queue");
await queue.setAutoplay(true);
console.log(queue.current?.song.name, queue.upcoming.length, queue.history.length);

const voice = queue.voice;
if (!voice) throw new Error("Queue is no longer attached");
await voice.setVolume(80);
await voice.filters.set("bassboost", 15);
await voice.setSelfDeaf(false);
await queue.stop(); // deletes the queue, keeps the voice and its settings
await voice.play({ kind: "url", url: "https://cdn.example/outro.mp3" });
await voice.leave(); // or distube.voices.leave(guildId)
```

`DisTubeQueue` owns `current`, `upcoming`, `history`, `status`, `repeat` and `autoplay`, and the schedule edits
`add`, `remove` (by ID, one-based position or range), `move`, `jump`, `previous`, `shuffle`, `clear` and
`addRelated`. Each insertion has its own item ID even for the same Song. History is bounded by the `historySize`
option (default 10).

`DisTubeVoice` owns the connection, `channelId`, `volume`, the `filters` manager, `selfDeaf` and `selfMute`, and can
play a track directly with `voice.play` when no queue is attached. Join one without a queue through
`distube.voices.join(channel, { selfDeaf, selfMute })` and move it with `voice.move(channel)`. While a queue is
attached, the voice's `play`, `stop`, `pause`, `resume` and `seek` reject `INVALID_STATE`; use the queue's controls.
`voice.leave()` deletes any attached queue and releases the connection; `distube.voices.leave(guildId)` does the same.

Stop and natural exhaustion delete the queue, which takes repeat, autoplay and history with it, and leave the voice
connected with its volume, filters, self-deaf and self-mute. Leaving voice releases the connection; the next voice
starts with default settings.

## Events and errors

Subscribe with dotted event names such as `"queue.item.added"`, `"queue.item.started"`, `"queue.history.added"`
and `"voice.track.finished"`. `on` returns an unsubscribe function. Queue events include their originating queue,
captured state, guild ID and commit timestamp; voice track events fire for direct and scheduled playback alike.
Listener failures go to safe diagnostics; application code owns bot replies.

All public failures are `DisTubeError` with a string `code`. Narrow with `DisTubeError.is(error, ErrorCode.NO_RESULT)`
for the core codes (`INVALID_ARGUMENT`, `INVALID_STATE`, `ABORTED`, `NO_RESULT`, `SOURCE_FAILED`, `VOICE_FAILED`,
`PLUGIN_FAILED`, `QUEUE_FAILED`, `UNSUPPORTED`) or with a plugin code such as `YouTubeErrorCode.NOT_FOUND`. Core
preserves a safe plugin error; it sanitizes unsafe messages and nested causes. See [Events and timing](wiki/Events-and-Timing.md) and
[Error handling](wiki/Error-Handling.md).

## Author extensions

Import application values and method-facing types from `distube`. Import `Adapter`, `Engine`, `Player`,
`VoiceSession`, `SourcePlugin` and playback resource contracts with `import type` from `distube/integrations`. A
source needs `name`, `stream` and at least one of `resolve` or `search`; the rest is optional. Integrations own
provider and platform policy, native resources and package-local tests. Core owns queue state and exactly-once
source-resource disposal.
See the [authoring guide](wiki/Plugin-Authoring.md), [Adapter authoring](wiki/Adapter-Authoring.md) and
[MIGRATION.md](MIGRATION.md).

## Files, streams and authenticated URLs

For sound effects or generated audio, use direct `voice.play` with a fresh resource. Local engines accept
absolute files, Node readable streams and progressive HTTP(S) URLs with optional headers. Read
`voice.capabilities` for engine support and `voice.seekable` for the active track. Streams cannot seek; URL seeks
reopen the request and decode/discard to the offset. Each resource and readable is single-use, even after a
later compatibility rejection. See [direct inputs](wiki/Direct-Inputs.md) for copyable examples and cleanup rules.
