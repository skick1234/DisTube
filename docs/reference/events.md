---
title: Events
description: The typed event list, payloads and the order events fire in.
sidebar:
  order: 4
---

Subscribe with `distube.on(name, listener)` and keep the returned function, which removes the listener.

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

const unsubscribe = distube.on("queue.item.started", event => {
  console.log(event.guildId, event.item.song.name, event.timestamp);
});
unsubscribe();
```

| Event                   | Additional payload                               |
| ----------------------- | ------------------------------------------------ |
| `queue.created`         | none (the new queue is empty)                    |
| `queue.item.added`      | `item`                                           |
| `queue.playlist.added`  | `playlist`, `items`                              |
| `queue.item.started`    | `item`, optional `fallback`                      |
| `queue.item.finished`   | `item`                                           |
| `queue.item.failed`     | `item`, `error`                                  |
| `queue.finished`        | Playback ran out of items                        |
| `queue.autoplay.failed` | `song`, `error`                                  |
| `queue.deleted`         | `reason`                                         |
| `voice.disconnected`    | `voice`, `channelId`, `reason`, optional `error` |

`on` throws `INVALID_ARGUMENT` for a name that is not in this table, so a misspelled or v5 name fails at registration
instead of never firing.

Queue events carry `guildId`, the `queue`, a captured `state` (`current`, `upcoming`, `history`, `status`, `repeat`,
`autoplay`) and the `timestamp`. Voice events carry `guildId`, `voice` and `timestamp`.

`fallback` is the Song that actually plays when the item's plugin cannot stream, such as the YouTube video a Spotify
track was found as. `item.song` stays the Spotify Song. If nothing can play it, the item fails with `NO_RESULT`, or
`SOURCE_FAILED` when a search or stream failed.

## From v5

| v5 event      | v6                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------- |
| `initQueue`   | `queue.created`                                                                               |
| `addSong`     | `queue.item.added`                                                                            |
| `addList`     | `queue.playlist.added`                                                                        |
| `playSong`    | `queue.item.started`                                                                          |
| `finishSong`  | `queue.item.finished`; a skipped item publishes none                                          |
| `finish`      | `queue.finished`                                                                              |
| `deleteQueue` | `queue.deleted`                                                                               |
| `disconnect`  | `voice.disconnected`                                                                          |
| `error`       | `queue.item.failed`, and the rejection of `play` or `add`                                     |
| `noRelated`   | `queue.autoplay.failed`                                                                       |
| `empty`       | none, see [leave when empty](../../recipes/leave-when-empty/#leave-when-the-channel-is-empty) |
| `ffmpegDebug` | none, the built-in engine has no ffmpeg process                                               |
| `debug`       | the `onDiagnostic` option                                                                     |

## Reasons

`queue.deleted` reasons:

| Reason       | Cause                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `stop`       | `queue.stop()`                                                                                                   |
| `finished`   | The queue ran out of items. `queue.finished` came first.                                                         |
| `voice-loss` | The voice session was lost                                                                                       |
| `leave`      | `voice.leave()`, `voices.leave(guildId)`, or `stop()` during the first join                                      |
| `shutdown`   | `distube.dispose()`                                                                                              |
| `failed`     | The first insertion failed and left the queue empty, with no other insertion pending. No `queue.finished` fires. |

`voice.disconnected` reasons:

| Reason     | Cause                                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `left`     | `voice.leave()` or `voices.leave(guildId)`                                                                              |
| `removed`  | The platform removed the bot from voice, such as a member disconnecting it. No `error`.                                 |
| `platform` | The connection dropped beyond the adapter's recovery. `error` is `VOICE_DISCONNECTED`, the adapter's error its `cause`. |
| `shutdown` | `distube.dispose()`                                                                                                     |

The event fires once per voice, after that guild's `queue.deleted`.

## Order

- `getQueue(guildId)` finds the queue before `queue.created` arrives. The event does not promise that the media
  resolves or the insertion succeeds.
- Adding a Song fires one `queue.item.added`. Adding a Playlist fires one `queue.playlist.added` and no per-item
  events. `play` resolves after that. The item can still fail to prepare or play, which fires `queue.item.failed`
  for it.
- Each item gets at most one of `queue.item.finished` or `queue.item.failed`. History rules are on the [queue reference](../queue/#items-and-history).
- When the queue runs out, `queue.finished` fires, then `queue.deleted` with reason `finished`.
- When the voice session ends during a track, the order is `queue.deleted` with reason `voice-loss`, then
  `voice.disconnected` with reason `removed` or `platform`. The playing item gets no `queue.item.failed`, because
  the voice failed, not the item.

## Delivery

DisTube delivers each event in a later microtask, in emit order. A listener added during delivery does not receive
that event. A listener that throws or rejects affects nothing else and is reported to `onDiagnostic` with stage
`event.listener`.
