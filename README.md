# DisTube v6

DisTube coordinates music queues and voice playback. Choose a platform adapter and media sources, then pass the
voice channel you already have to `play`.

## Install

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Use `OceanicAdapter` from `@distube/oceanic` for oceanic.js or `ErisAdapter` from `@distube/eris` for Eris 0.18.
Local playback needs FFmpeg, an Opus implementation and a supported encryption implementation. See
[Installation](wiki/Installation.md) for platform requirements. Eris rejects seeking with `UNSUPPORTED`.

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
  console.log(item.song.name, item.metadata?.requestedBy);
});

const pending = distube.play(voiceChannel, "never gonna give you up", {
  metadata: { requestedBy: "user-id" },
});
const registeredQueue = distube.getQueue(voiceChannel.guildId); // Already registered.
const { queue, items } = await pending;
console.log(queue === registeredQueue, items.length);

// During application teardown:
unsubscribe();
await distube.dispose();
```

Construction validates local configuration and initializes sources synchronously without provider requests or voice
joins. `play` copies channel identity, validates shallow input and registers its queue before returning the promise.
The queue is immediately readable as idle with no items while resolution runs. `queue.created` means registration;
it does not mean insertion or playback succeeded.

`play` resolves with `{ queue, items }` after insertion commits. Listen for `queue.item.started` or
`queue.item.failed` for the later playback outcome. Each call keeps its original queue identity. If failed initial
work leaves no item or pending insertion, that queue is deleted without a fabricated `queue.finished` event.
Another call's queue or adopted voice is preserved.

## Resolve and choose sources

Absolute HTTP(S) URLs go to source resolution; other non-empty strings are queries. Sources run in configured order.
A URL is never retried as a query. Query search can continue to a later source when an earlier source fails.
`distube.resolve(input, { signal })` returns a `Song` or `Playlist` without creating a queue or joining voice.
Pass that media to `play` later, or use `queue.enqueue(input, options)` on an existing connected queue.

For a candidate list to show the user, retain the source instance and call its bounded search API:

```ts
const results = await youtube.search("DisTube tutorial", { limit: 5 });
```

Spotify can return an explicit fallback query for playback through another configured source. The original Song and
QueueItem remain public; signed playback URLs and candidate resources remain private.

The adapter supplies the default engine. For a remote engine such as Lavalink, pass the same instance explicitly in
`sources` and `engine`. It initializes and disposes once. See [Adapter authoring](wiki/Adapter-Authoring.md).

## Control queue and voice

```ts
await queue.pause();
await queue.resume();
await queue.seek(30);
const next = queue.state.upcoming[0];
if (next) await queue.move(next.id); // Move this waiting occurrence to the tail.
await queue.skip();

const voice = distube.voices.get(voiceChannel.guildId)!;
await voice.setVolume(80);
await voice.setRepeat("queue");
await voice.setAutoplay(true);
await voice.setFilters(["nightcore"]);
await queue.stop();
await distube.voices.leave(voiceChannel.guildId);
```

`DisTubeGuild` owns `state.current`, `state.upcoming`, `state.status` and queue controls. Edit waiting occurrences
with `remove(itemId)` and `move(itemId, beforeItemId?)`. Each insertion has its own ID even for the same Song.
`DisTubeVoice` owns the connection, live `channelId` and readonly `settings`. It can exist without a queue through
`distube.voices.join(channel)` and move with `voice.move(channel)`.

Stop and natural exhaustion delete the queue but retain voice, volume, repeat and autoplay. Successful deletion
cleanup clears both selected filters and backend rendering. A failed reset reports the cleanup error and preserves
last acknowledged filter state. A later queue waits for old cleanup before backend effects begin. Leaving voice
releases the connection; the next voice starts with default settings.

## Events and errors

Subscribe with dotted event names such as `"queue.item.added"`, `"queue.playlist.added"` and
`"queue.item.started"`. `on` returns an unsubscribe function. Queue events include their originating queue, captured
state, guild ID and commit timestamp. Listener failures go to safe diagnostics; application code owns bot replies.

All public failures are `DisTubeError`. Compare its literal `code`: `INVALID_ARGUMENT`, `INVALID_STATE`, `ABORTED`,
`SOURCE_FAILED`, `VOICE_FAILED`, `PLUGIN_FAILED`, `QUEUE_FAILED` or `UNSUPPORTED`.
See [Events and timing](wiki/Events-and-Timing.md) and [Error handling](wiki/Error-Handling.md).

## Author extensions

Import application values and method-facing types from `distube`. Import `Adapter`, `Engine`, `Player`,
`VoiceSession`, `SourcePlugin` and playback resource contracts with `import type` from `distube/integrations`.
Integrations own provider/platform policy, native resources and package-local tests. Core owns queue state and
exactly-once source-resource disposal. See the [authoring guide](wiki/Plugin-Authoring.md) and
[breaking migration guide](wiki/Major-Upgrade-Guide.md).
