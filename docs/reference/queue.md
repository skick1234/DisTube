---
title: Queue
description: Queue state, every control, items, history and typed metadata.
sidebar:
  order: 2
---

A `DisTubeQueue` is what `distube.play` returns and `distube.getQueue(guildId)` finds. How it relates to the voice
and how `play` creates it is on [how DisTube works](../../get-started/how-distube-works/).

## State

| Property   | Value                                                          |
| ---------- | -------------------------------------------------------------- |
| `current`  | The playing `QueueItem`, or `undefined`                        |
| `upcoming` | Waiting items, in order                                        |
| `history`  | Finished or skipped items, newest last, up to `historySize`    |
| `status`   | `idle`, `playing` or `paused`                                  |
| `repeat`   | `off`, `song` or `queue`                                       |
| `autoplay` | Whether autoplay is on                                         |
| `paused`   | Whether playback is paused                                     |
| `position` | Elapsed seconds of the current item, `0` when none has started |
| `voice`    | The [`DisTubeVoice`](../voice-and-filters/)                    |

## Adding

`play`, `queue.add` and `distube.resolve` take the same input kinds, described under
[plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order). `queue.add` inserts into an
existing queue, never joins or moves the voice, and resolves with the inserted items.

`play` and `add` take `{ metadata, signal, next, at }`.

- `next: true` inserts at the front of `upcoming`.
- `at` is a zero-based position evaluated when the insertion happens. A position past the end appends.
- Giving both rejects `INVALID_ARGUMENT`.
- A Playlist inserts its Songs together, in order.

## Controls

| Method                        | Effect                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pause()`, `resume()`         | Take effect once the player confirms. Calling them twice is harmless. A pause ends with its item, so the next item starts unpaused.                         |
| `seek(seconds)`               | Moves within the current item. See the errors below.                                                                                                        |
| `skip()`                      | Ends the current item and moves to the next, ignoring song repeat.                                                                                          |
| `jump(target, { requeue? })`  | `target` is a waiting item ID or a one-based position. Skipped items go to history, or to the tail with `requeue`.                                          |
| `previous()`                  | Needs history. Puts the current item at the front of `upcoming` and replays the newest history Song as a fresh item.                                        |
| `shuffle()`                   | Reorders `upcoming`. The current item is untouched.                                                                                                         |
| `clear()`                     | Empties `upcoming`. The current item keeps playing.                                                                                                         |
| `remove(target)`              | `target` is an item ID, a one-based position or an inclusive range `{ from, to }`. Returns the removed items.                                               |
| `move(itemId, beforeItemId?)` | Moves a waiting item before another, or to the tail without a destination.                                                                                  |
| `setRepeat(mode)`             | `"off"`, `"song"` or `"queue"`.                                                                                                                             |
| `setAutoplay(enabled)`        | Adds a related Song when the queue ends. See below.                                                                                                         |
| `stop()`                      | Deletes the queue now with `queue.deleted` reason `stop`. The voice keeps its settings. During the bot's first join it leaves instead, with reason `leave`. |

`add`, `play`, `pause`, `resume`, `seek`, `skip`, `jump`, `previous` and `stop` return promises. `remove`, `move`,
`shuffle`, `clear`, `setRepeat` and `setAutoplay` finish before they return.

The synchronous controls throw `INVALID_ARGUMENT` for malformed values and `INVALID_STATE` for stale IDs, the current
item or positions that do not point at a waiting item. Every control except `stop()` rejects `INVALID_STATE` on a deleted queue. `stop()` resolves.

`seek` on a started item rejects `UNSUPPORTED` for a resource or engine that cannot seek, and `INVALID_ARGUMENT` for a
negative or non-finite value or one past a known duration. A missing duration does not block a seek.

Repeat and autoplay belong to the queue and go with it. Autoplay asks the owning plugin's `related` for a Song that
follows the item that last finished or was skipped, and passes the history so it avoids repeats. A failure publishes
`queue.autoplay.failed`. Recipes: [queue controls](../../recipes/queue-controls/),
[repeat and autoplay](../../recipes/repeat-and-autoplay/), [pause, resume and seek](../../recipes/pause-resume-seek/).

## Items and history

Each `QueueItem` has `id`, `song`, `metadata`, `autoplay` and `addedAt`, the creation time in epoch milliseconds.
`autoplay` is true for an item that autoplay added. Its `metadata` is the same reference as the item it followed, so
check `autoplay` before crediting a requester.

`history` keeps the most recently finished or skipped items, newest last, up to `historySize`. An item skipped while
it was still preparing never played and is not kept. Failed items are never kept. Read `queue.history` after
`queue.item.finished`.

## Metadata

`new DisTube<Metadata>(...)` types the metadata of every item. DisTube stores your reference as is, without reading,
cloning or freezing it.

```ts
import type { DisTube, VoiceChannelTarget } from "distube";

declare const distube: DisTube<{ requestedBy: string }>;
declare const channel: VoiceChannelTarget;

distube.on("queue.item.added", ({ item }) => {
  console.log(item.metadata.requestedBy);
});
await distube.play(channel, "a song query", { metadata: { requestedBy: "user-id" } });
```

Without a type parameter, metadata is `undefined` and `play` and `add` take none. A type that excludes `undefined`,
as above, makes `metadata` required, and every item, queue state and event carries it. Write
`{ requestedBy: string } | undefined` to keep it optional.
