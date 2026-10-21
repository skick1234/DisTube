---
title: DisTube guide
description: Queue and voice controls, search, suggestions and disposal.
sidebar:
  order: 3
---

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
  historySize: 20,
  engine: { bufferMs: 400 },
});
const pending = distube.play(voiceChannel, "https://youtu.be/example");
const registered = distube.getQueue(voiceChannel.guildId);
const queue = await pending;
console.log(queue === registered);
```

## Options

| Option                  | Default  | Meaning                                                                                                 |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `adapter`               | none     | The platform Adapter. Required.                                                                         |
| `plugins`               | none     | Ordered array of sources. At most one may carry an `engine`, which replaces the built-in one. Required. |
| `historySize`           | 10       | Ended items each queue remembers. `0` disables history.                                                 |
| `filters`               | built-in | Filter presets merged over the built-in engine's. Ignored when an engine plugin is configured.          |
| `connectionTimeoutMs`   | 15000    | How long a voice join waits.                                                                            |
| `onDiagnostic`          | none     | Receives listener failures and plugin diagnostics.                                                      |
| `engine.opusComplexity` | 10       | Opus encoder complexity, 0 to 10. Lower uses less CPU.                                                  |
| `engine.bufferMs`       | 500      | Read-ahead in milliseconds, a positive multiple of 20.                                                  |

`bufferMs` is added latency. The engine keeps `bufferMs / 20` packets ahead, so a volume or filter change becomes
audible up to `bufferMs` later. The `engine` section configures the built-in engine only. An invalid option rejects
`INVALID_ARGUMENT` from the constructor.

## Registration and insertion

After shallow validation, `play` synchronously registers one queue for the guild. `getQueue` and `queues` see it
immediately, even while resolution is pending. Its initial state is idle with no current or upcoming items. The
call keeps that exact queue and cannot insert into a replacement after stop.

Calls for one guild commit in invocation order. Another guild progresses independently. `queue.created` describes
registration. `play` settles only after insertion. If failed initial work leaves the queue with no items and no
pending insertion, core deletes it with `queue.deleted` reason `failed` and no `queue.finished`.

`play`, `queue.add` and `distube.resolve` accept a query string, a URL string, a `Song` or a `Playlist`. An
absolute HTTP(S) URL goes to each plugin's `resolve` in order. Any other non-empty string goes to `search`, and the
first plugin that returns results wins. When no plugin answers, the call rejects `NO_RESULT`. If some plugins
failed while searching, it rejects `SOURCE_FAILED` with every failure in an `AggregateError` cause. A Song or
Playlist whose `source` is not a configured plugin rejects `INVALID_ARGUMENT`. `resolve` creates no queue or voice.
`queue.add` inserts into an existing queue and never joins or moves the voice. It resolves with the inserted items.

Both `play` and `add` take `{ metadata, signal, next, at }`. `next` inserts at the front of `upcoming`. `at` is a
zero-based position evaluated when the insertion commits, and a position past the end appends. Supplying both
rejects `INVALID_ARGUMENT`. A Playlist inserts its Songs contiguously.

## Queue controls

`DisTubeQueue` exposes readonly `current`, `upcoming`, `history`, `status` (`idle`, `playing` or `paused`),
`repeat`, `autoplay`, `position` (elapsed seconds, zero without a current item) and `voice`. `pause`, `resume`
and `seek` forward to the voice. `status` follows the voice's paused state, including a direct `voice.pause()`.
`skip` ends the current item and moves to the next without applying song repeat.

- `jump(target, { requeue? })` takes a waiting item ID or a one-based position in `upcoming`. Without `requeue`
  the current item and everything before the target go to history. With it they are appended to the tail.
- `previous()` needs a non-empty history. It moves the current item to the front of `upcoming` and starts a fresh
  occurrence of the newest history Song.
- `shuffle()` reorders `upcoming` and never touches the current item.
- `clear()` empties `upcoming`. The current item keeps playing.
- `remove(target)` accepts an item ID, a one-based position or an inclusive range `{ from, to }`, and resolves with
  the removed items.
- `move(itemId, beforeItemId?)` moves a waiting item before another one, or to the tail when the destination is
  omitted.
- `addRelated()` appends one related occurrence of the current or most recent Song and resolves with it.

Positions resolve when the edit commits, so a concurrent insert cannot make a positional remove delete the wrong
item. Malformed values reject `INVALID_ARGUMENT`. Current, stale and non-waiting IDs or positions reject
`INVALID_STATE`.

`setRepeat("off" | "song" | "queue")` and `setAutoplay(boolean)` belong to the queue and reset with it. Autoplay
asks the owning plugin's `related` for a Song that follows the item that last finished or was skipped, and passes
the history as an exclusion list. A failure publishes `queue.autoplay.failed`.

`history` holds the most recently finished or skipped items, newest last, bounded by `historySize`. An item skipped
while it was still preparing never played and does not enter history. Failed items never enter it. Every append
publishes `queue.history.added`.

`stop()` unregisters and deletes the queue immediately, publishes `queue.deleted` with reason `stop`, then stops
the voice's track. Other controls on a deleted queue reject `INVALID_STATE`. A later `play` registers a fresh queue
over the same voice.

## Voice

Get a `DisTubeVoice` through `queue.voice` or `distube.voices.get(guildId)`, or join without a queue with
`await distube.voices.join(channel, { selfDeaf?, selfMute?, signal? })`. The join options apply when the join
creates the connection (self-deaf defaults to on, self-mute to off). Read the live `channelId`, `volume`,
`bitrate`, `selfDeaf`, `selfMute`, `paused`, `position` and `filters`. Use `voice.move(channel)` for a move within
the guild. `voice.leave()` and `distube.voices.leave(guildId)` delete the attached queue, release the Player and
the session, and publish `voice.disconnected` with reason `left`. Both are idempotent.

- `setVolume(percent)` takes a finite number from 0 to 100. The default is 100.
- `setBitrate(bps | "auto")` takes an integer from 6000 to 510000, or `"auto"` to follow the channel's bitrate
  (the default). A value set before the first track applies when the Player starts. An engine that cannot change
  bitrate rejects a number with `UNSUPPORTED`.
- `setSelfDeaf(enabled)` and `setSelfMute(enabled)` update the bot's voice state.
- `filters` is a manager with `set(name, value?)`, `toggle(name, value?)`, `remove(name)`, `clear()`, `has(name)`,
  `names`, `entries` (`{ name, value?, label }`) and `definitions` (`{ default, min, max, acceptsValue, label() }`
  per preset). A ranged preset clamps its value. A fixed preset rejects one with `INVALID_ARGUMENT`. A preset the
  engine does not render rejects `UNSUPPORTED`. A change commits once the Player acknowledges it.

The built-in presets are `3d`, `bassboost`, `earwax`, `echo`, `flanger`, `gate`, `haas`, `karaoke`, `mcompand`,
`nightcore`, `phaser`, `surround`, `tremolo` and `vaporwave`. Add or override presets with the top-level `filters`
option.

The voice can play on its own: `await voice.play(resource, { signal?, onStart? })` resolves with
`{ reason: "finished" | "stopped" | "replaced" }` when the track ends. See [direct inputs](../direct-inputs/).
`stop()`, `pause()`, `resume()` and `seek(seconds)` act on the active track. A new `play` replaces the current
track, whether it came from the queue or from your code (last writer wins).

Volume, bitrate, filters, self-deaf and self-mute stay on the voice when a queue is deleted. `voices.leave(guildId)`
releases the voice and those settings, and a later connection starts with defaults. To clear filters when a queue
ends, call `voice.filters.clear()` from a `queue.deleted` listener.

## Search and suggestions

`distube.search(query, { source?, limit?, offset?, signal? })` returns ranked Songs. The defaults are limit 10 and
offset 0, and an offset past the available results returns an empty list. With `source` set to a configured plugin
instance it searches only that plugin and types `pluginData` by it. Without it, plugins are consulted in order and
the first non-empty result wins. `distube.getSuggestions(query, source?)` returns up to 25 completions from the
named plugin or the first one that answers. A plugin instance that is not configured on this client rejects
`INVALID_ARGUMENT`. Plugin errors propagate.

## Metadata, events and teardown

`new DisTube<Metadata>({ adapter, plugins })` types the metadata of every QueueItem. Core stores the caller's
reference without cloning, reading or freezing it.

Subscribe with `distube.on("queue.item.started", listener)` and keep the returned unsubscribe function. See
[events and timing](../events-and-timing/). Call `await distube.dispose()` during application teardown. It deletes
every queue, releases every voice, then disposes the plugins in reverse order.
