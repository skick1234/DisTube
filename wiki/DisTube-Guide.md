# DisTube guide

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  sources: [new YouTubePlugin()],
  historySize: 20,
});
const pending = distube.play(voiceChannel, "https://youtu.be/example");
const registered = distube.getQueue(voiceChannel.guildId);
const queue = await pending;
console.log(queue === registered);
```

## Registration and insertion

After shallow validation, `play` synchronously registers and reserves one queue for the guild. Lookup and readonly
queue iteration see it immediately, even while source resolution is pending. Its initial state is idle with no
current or upcoming items. The call keeps that exact queue and cannot insert into a replacement after stop.

Calls for one guild run in invocation order. Another guild can progress independently. `queue.created` describes
registration; `play` settles successfully only after insertion. If failed initial work leaves no playback or pending
reservation, its queue is deleted without `queue.finished`. It cannot delete another reservation's queue or release
voice another caller adopted.

`play`, `queue.add` and `distube.resolve` accept a query string, a URL string, a `Song` or a `Playlist`.
Absolute HTTP(S) URLs use configured sources' resolution in order, never query fallback. Other non-empty strings
use source search. The first source returning candidates wins; a failed search can yield to a later source, and a
query every source declines rejects `NO_RESULT`. Standalone `resolve` creates no queue or voice. `add` requires its
existing queue's connected voice and cannot create a queue, join or move voice.

Both `play` and `add` take `{ metadata, signal, next, at }`. `next` inserts at the front of `upcoming`; `at` is a
zero-based position evaluated when the insertion commits, and a position past the end appends. Supplying both
rejects `INVALID_ARGUMENT`. A Playlist inserts its Songs contiguously at that position.

## Queue controls

`DisTubeQueue` exposes readonly `current`, `upcoming`, `history`, `status` (`idle`, `playing` or `paused`),
`repeat`, `autoplay` and `position` (elapsed seconds read from the voice, zero without a current item). `pause`,
`resume`, `seek` and `skip` control current playback; state commits only after the backend acknowledges the effect.
`skip` ends the current item and tries its successor without applying song repeat.

Schedule edits:

- `jump(target, { requeue? })` takes a waiting item ID or a one-based position in `upcoming`, ends the current item
  once and starts the target. Without `requeue` the current item and everything before the target go to history;
  with it they are appended to the tail in their original order.
- `previous()` needs a non-empty history. It moves the current item to the front of `upcoming` and starts a fresh
  occurrence of the newest history Song with the same metadata reference.
- `shuffle()` reorders `upcoming` and never touches the current item.
- `clear()` empties `upcoming` and cancels any preparation in flight; the current item keeps playing.
- `remove(target)` accepts an item ID, a one-based position or an inclusive range `{ from, to }`, and resolves with
  the removed items.
- `move(itemId, beforeItemId?)` moves a waiting item before another one, or to the tail when the destination is
  omitted. Moving before itself does nothing.
- `addRelated()` appends one related occurrence of the current or most recent Song and resolves with it.

Positions resolve when the edit commits, so a concurrent insert cannot make a positional remove delete the wrong
item. Malformed values reject `INVALID_ARGUMENT`; current, stale and non-waiting IDs or positions reject
`INVALID_STATE`.

`setRepeat("off" | "song" | "queue")` and `setAutoplay(boolean)` belong to the queue and reset with it. Autoplay
asks the current Song's source for a related Song and passes the history as an exclusion list.

`history` holds the most recently finished, skipped or jumped-over items, newest last, bounded by
`DisTubeOptions.historySize` (default 10, `0` disables it). Failed items never enter it. Every append publishes
`queue.history.added`.

`stop` detaches the queue from its voice, deletes the queue and fences pending work immediately, then joins cleanup.
Repeated stop joins the same outcome. Other controls on a deleted queue reject `INVALID_STATE`. A later `play`
registers a fresh queue over the same voice while backend effects wait for the old cleanup to settle.

## Voice

Get `DisTubeVoice` through `distube.voices.get(guildId)` or independently with
`await distube.voices.join(channel, { selfDeaf?, selfMute?, signal? })`. Read its live `channelId`, `volume`,
`selfDeaf`, `selfMute`, `position` and `filters`. Use `voice.move(channel)` for a same-guild move and
`voice.leave()` or `distube.voices.leave(guildId)` to disconnect. Both fence and delete an attached queue first,
release the Player then the session, and publish `voice.disconnected` with reason `left`. Both are idempotent;
`voice.leave()` on a handle whose guild already has a newer voice does nothing.

- `setVolume(percent)` accepts finite 0 to 100, default 100.
- `setSelfDeaf(enabled)` and `setSelfMute(enabled)` update the bot's voice state and resolve after the gateway
  acknowledges. Join defaults are self-deaf on and self-mute off.
- `filters` is a manager: `set(name, value?)`, `toggle(name, value?)`, `remove(name)`, `clear()`, `has(name)`,
  `names`, `entries` (`{ name, value?, label }`) and `definitions` (`{ default, min, max, acceptsValue, label() }`
  per preset). A ranged preset clamps its value; a fixed preset rejects one with `INVALID_ARGUMENT`; an unknown
  preset rejects `UNSUPPORTED`. Each mutation renders once and commits after acknowledgement.

The voice can play on its own. `voice.play(resource, { itemId? })`, `stop()`, `pause()`, `resume()` and
`seek(seconds)` drive the voice-owned Player directly and publish `voice.track.started`, then one of
`voice.track.finished` or `voice.track.failed`. While a queue is attached those five controls reject `INVALID_STATE`;
`queue.stop()` detaches synchronously and the voice accepts them again. `seek` rejects `UNSUPPORTED` when the engine
reports `capabilities.seek` false or the active input is not seekable. Official local engines support seeking
files and explicitly seekable URLs; `voice.seekable` combines resource and engine support.

Volume, filters, self-deaf and self-mute survive queue stop and exhaustion. `voices.leave(guildId)` releases the
voice and those settings; a later connection starts with defaults. Nothing on the voice resets when a queue is
deleted. If you want filters cleared at that point, call `voice.filters.clear()` from a `queue.deleted` listener.

## Search and suggestions

`distube.search(query, { source?, limit?, offset?, signal? })` returns ranked Songs. With `source` set to one of
the configured plugin instances it searches only that plugin and types `pluginData` by it. Without it, sources are
consulted in constructor order and the first non-empty result wins. `distube.getSuggestions(query, source?)`
returns provider completions for autocomplete from the optional `suggest` member. A source instance not configured
on this client rejects `INVALID_ARGUMENT`.

## Metadata, events and teardown

`new DisTube<Metadata>({ adapter, sources })` types occurrence metadata. Core borrows the optional caller reference
without cloning, reading or freezing its contents. The occurrence property binding is readonly. Keep other guild
application state in application-owned storage.

Subscribe using `distube.on("queue.item.started", listener)` and retain the returned unsubscribe function. Queue
exhaustion publishes `queue.finished` then `queue.deleted`; pending insertion reservations prevent premature
exhaustion. Caller cancellation before commit rejects `ABORTED`; stop or disposal supersession rejects
`INVALID_STATE`. Call `await distube.dispose()` during application teardown.
