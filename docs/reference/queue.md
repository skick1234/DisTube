---
title: Queue
description: Queue state, every control, items, history and typed metadata.
sidebar:
  order: 2
---

A `DisTubeQueue` is one guild's playlist: what plays now, what waits, and what already played. `distube.play` resolves
it as `queue`, and `distube.getQueue(guildId)` finds it. [How DisTube works](../../get-started/how-distube-works/)
explains how a queue relates to the voice and when `play` creates one.

## State

| Property       | What it holds                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `guildId`      | The guild this queue belongs to                                                                                                |
| `current`      | The `QueueItem` handed to the player, audible once `status` is `playing`. `undefined` when there is none.                      |
| `upcoming`     | The items waiting to play, in order                                                                                            |
| `history`      | Items that finished or were skipped, newest last, up to `historySize`                                                          |
| `status`       | `idle`, `preparing`, `playing` or `paused`. See [Status](#status).                                                             |
| `repeat`       | `off`, `song` or `queue`                                                                                                       |
| `autoplay`     | `true` when autoplay is on                                                                                                     |
| `paused`       | `true` while the current item is paused                                                                                        |
| `position`     | Seconds played of the current item, `0` before it starts                                                                       |
| `playbackRate` | Source seconds that play per second of wall time. `1` without a voice or without filters that change speed.                    |
| `voice`        | The guild's [`DisTubeVoice`](../voice-and-filters/). `undefined` until the first item is added and after the queue is deleted. |

## Status

`status` tells a view whether to show "loading", a running clock or nothing.

| Status      | When                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `idle`      | Nothing is current or waiting, and no autoplay lookup is due                                                     |
| `preparing` | An item waits in `upcoming`, an autoplay lookup runs, or the current item is with the player but not audible yet |
| `playing`   | The current item is audible, and `queue.item.started` has fired                                                  |
| `paused`    | A pause has taken effect on the current item                                                                     |

The queue reads `preparing` from the first insertion until the first track is audible, and again between items. A view
never flashes `idle` while another item or a lookup follows.

Here is how one item moves through it. While DisTube prepares the item's audio, the item stays `upcoming[0]` and
`current` is `undefined`. When the player takes it, it becomes `current` with `position` `0`, and the status is still
`preparing`. When audio starts, the status turns `playing`. A pause after the player took the item reads `paused`.

An autoplay lookup is due when autoplay is on, an item has played, no failed autoplay item stopped lookups, and no
insertion is pending. `setAutoplay(false)` during a lookup switches to `idle` at once.

`position` advances only while `status` is `playing`. It moves `playbackRate` source seconds per second of wall time, so
nightcore at `1.25` advances `1.25` seconds per second. Every change to the state, the pause or the position publishes
[`queue.updated`](../events/#queueupdated), and [Announce what is playing](../../guides/now-playing/#live-status-updates)
shows how to keep a clock running between updates.

## Adding

`play`, `queue.add` and `distube.resolve` take the same kinds of input: a URL, a search query, a Song or a Playlist.
[Plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order) explains which plugin answers
each.

`play` joins the channel you pass, or moves the guild's voice there, and resolves `{ queue, items }`. `items` are the
items this call added, in order, the same ones its `queue.item.added` or `queue.playlist.added` event carries. Two
commands running at once each get their own items, so a reply never lists another command's songs.

```ts
import type { DisTube, VoiceChannelTarget } from "distube";

declare const distube: DisTube;
declare const channel: VoiceChannelTarget;

const { queue, items } = await distube.play(channel, "https://youtube.com/playlist?list=example");
console.log(`Added ${items.length} items. ${queue.upcoming.length} are waiting.`);
```

`queue.add` adds to a queue you already hold. It never joins or moves the voice, and it resolves the added items. It
rejects `INVALID_STATE` when the guild has no voice by the time the media resolves, so use `play` for a first song.

Both take the same options:

| Option               | What it does                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------ |
| `metadata`           | Your own value, stored on every item the call adds. See [Metadata](#metadata).                         |
| `next`               | `true` puts the items at the front of `upcoming`.                                                      |
| `at`                 | A zero-based position in `upcoming`, read when the insertion happens. A position past the end appends. |
| `signal`             | An `AbortSignal` that cancels the call. See [cancellation](../errors/#cancellation).                   |
| `allowAgeRestricted` | `true` lets age-restricted media in. Defaults to `false`, which rejects `AGE_RESTRICTED`.              |

- Giving both `next` and `at` rejects `INVALID_ARGUMENT`.
- A Playlist inserts its Songs together, in order.
- Calls for one guild insert in the order you made them.
- Without `allowAgeRestricted`, a Playlist drops its age-restricted Songs and keeps the rest. When a single Song from a
  search, or one you pass in, has an unknown age restriction, DisTube first looks it up by its URL through its plugin.
  Autoplay ignores the option.

## Controls

| Method                        | What it does                                                                                           | Returns                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `pause()`, `resume()`         | Pause or resume the current item, once the player confirms. Calling either twice is harmless.          | `Promise<void>`                   |
| `seek(seconds)`               | Move to a point in the current item.                                                                   | `Promise<void>`                   |
| `skip()`                      | End the current item, or drop the one still preparing, and move on. Ignores song repeat.               | `Promise<QueueItem \| undefined>` |
| `jump(target, { requeue? })`  | Skip to a waiting item. `target` is its ID or its one-based position.                                  | `Promise<void>`                   |
| `previous()`                  | Replay the newest history Song as a fresh item. The current item goes back to the front of `upcoming`. | `Promise<void>`                   |
| `stop()`                      | Delete the queue now. The voice stays, with its settings.                                              | `Promise<void>`                   |
| `shuffle()`                   | Reorder `upcoming`. The current item keeps playing.                                                    | `void`                            |
| `clear()`                     | Empty `upcoming`. The current item keeps playing.                                                      | the removed items                 |
| `remove(target)`              | Remove waiting items. `target` is an ID, a one-based position or an inclusive range `{ from, to }`.    | the removed items                 |
| `move(itemId, beforeItemId?)` | Move a waiting item before another one, or to the end when you give no second ID.                      | `void`                            |
| `setRepeat(mode)`             | Set repeat to `"off"`, `"song"` or `"queue"`.                                                          | `void`                            |
| `setAutoplay(enabled)`        | Turn autoplay on or off. See [Repeat and autoplay](#repeat-and-autoplay).                              | `void`                            |

The methods that do not return a promise finish their change before they return.

A few controls need more detail:

- A pause ends with its item, so the next item always starts unpaused.
- `skip` resolves the item that was first in `upcoming` when the skip happened. It resolves `undefined` when nothing
  waited, even if autoplay is about to look one up.
- `skip` resolves once the ended item has stopped. It does not wait for the next item to start, so a next item that
  fails never turns a skip into a rejection.
- Skipping the last item ends the queue unless autoplay finds a Song.
- `jump` sends the current item and the items before the target to history. With `requeue: true` it appends them to
  the end of `upcoming` instead.
- `stop()` deletes the queue with `queue.deleted` reason `stop`. During the bot's first join it leaves instead, with
  reason `leave`.

```ts
import type { DisTubeQueue } from "distube";

declare const queue: DisTubeQueue;

const next = await queue.skip();
console.log(next ? `Up next: ${next.song.name}` : "Nothing is waiting.");
```

The guides walk through each control:
[Skip, jump, shuffle and edit the queue](../../guides/queue-controls/), [Pause, resume and seek](../../guides/pause-resume-seek/)
and [Repeat and autoplay](../../guides/repeat-and-autoplay/).

### When a control fails

- Every control except `stop()` rejects, or throws, `INVALID_STATE` on a deleted queue. `stop()` resolves.
- The controls that return at once throw `INVALID_ARGUMENT` for a malformed value. They throw `INVALID_STATE` for a
  stale ID, the current item's ID, or a position that does not point at a waiting item.
- `pause`, `resume` and `seek` reject `INVALID_STATE` when no item has started, or when the item ends before the
  change lands.
- `skip` rejects `INVALID_STATE` when nothing is playing or waiting, and while an earlier `skip`, `jump` or `previous`
  is still ending its item.
- `previous` rejects `INVALID_STATE` when history is empty.
- `seek` rejects `INVALID_ARGUMENT` for a negative or non-finite value, or one past a known duration. A Song with no
  duration can still seek. It rejects `UNSUPPORTED` when the item's audio or the engine cannot seek, such as a live
  stream.

## Repeat and autoplay

Repeat and autoplay belong to the queue and go away with it.

- `song` repeat replays the current item when it finishes. `queue` repeat adds it back to the end of `upcoming`. A
  skip never repeats.
- Autoplay adds a related Song when nothing is left. It calls `related` on the plugin that owns the last item that
  finished or was skipped, and passes the history so the plugin avoids repeats.
- If that plugin has no `related` and the item played through a `fallback`, autoplay asks the fallback's plugin
  instead. [Spotify](../../plugins/spotify/#autoplay) works this way.
- A failure publishes `queue.autoplay.failed`.

## Items and history

Each `QueueItem` is one entry in the queue. The same Song added twice makes two items.

| Field      | What it holds                                                     |
| ---------- | ----------------------------------------------------------------- |
| `id`       | A unique ID for this item. `jump`, `remove` and `move` take it.   |
| `song`     | The `Song`: name, URL, duration, thumbnails and the plugin's data |
| `metadata` | The value you passed to `play` or `add`                           |
| `autoplay` | `true` when autoplay added the item                               |
| `playlist` | The Playlist the item came from, when it came from one            |
| `addedAt`  | When the item was created, in epoch milliseconds                  |

An autoplay item copies the `metadata` reference of the item it followed. Check `autoplay` before you credit the
requester.

`playlist` is the Playlist as the queue added it, after `maxPlaylistSongs` and the age filter, the same value
`queue.playlist.added` carries. A Song insertion and an autoplay item have none. Repeat and `previous` keep it on the
replayed item. DisTube never reads it, so you can show "from playlist X" without a lookup table of your own.

`history` keeps the most recent items that finished or were skipped, newest last, up to `historySize`. An item skipped
while it was still preparing never played, so history does not keep it. Failed items never enter history. Read
`queue.history` after `queue.item.finished`, whose `state.history` already ends with the finished item.

## Metadata

`new DisTube<Metadata>(...)` sets the type of every item's `metadata`. DisTube stores your value as it is. It never
reads, copies or freezes it.

```ts
import type { DisTube, VoiceChannelTarget } from "distube";

declare const distube: DisTube<{ requestedBy: string }>;
declare const channel: VoiceChannelTarget;

distube.on("queue.item.added", ({ item }) => {
  console.log(item.metadata.requestedBy);
});
await distube.play(channel, "a song query", { metadata: { requestedBy: "user-id" } });
```

Without a type parameter, `metadata` is `undefined`, and `play` and `add` take none. A type that excludes `undefined`,
as above, makes `metadata` required on every call, and every item, queue state and event carries it. To keep it
optional, write `{ requestedBy: string } | undefined`.
