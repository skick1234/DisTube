---
title: Events and timing
description: The typed event list and the order events fire in.
sidebar:
  order: 5
---

Subscribe to typed dotted names on the client:

| Event                   | Additional payload                               |
| ----------------------- | ------------------------------------------------ |
| `queue.created`         | Registration of an empty queue                   |
| `queue.item.added`      | `item`                                           |
| `queue.playlist.added`  | `playlist`, `items`                              |
| `queue.item.started`    | `item`                                           |
| `queue.item.finished`   | `item`                                           |
| `queue.item.failed`     | `item`, `error`                                  |
| `queue.finished`        | Playback ran out of items                        |
| `queue.autoplay.failed` | `song`, `error`                                  |
| `queue.deleted`         | `reason`                                         |
| `voice.disconnected`    | `voice`, `channelId`, `reason`, optional `error` |

Queue events carry `guildId`, the `queue`, a captured `state` (`current`, `upcoming`, `history`, `status`,
`repeat`, `autoplay`) and the commit `timestamp`. Voice events carry `guildId`, `voice` and `timestamp`.

`queue.deleted` reasons:

| Reason       | Cause                                                    |
| ------------ | -------------------------------------------------------- |
| `stop`       | `queue.stop()`                                           |
| `finished`   | The queue ran out of items. `queue.finished` came first. |
| `voice-loss` | The voice session was lost                               |
| `leave`      | `voice.leave()` or `voices.leave(guildId)`               |
| `shutdown`   | `distube.dispose()`                                      |
| `failed`     | The first insertion failed and left the queue empty      |

`voice.disconnected` reasons are `left`, `platform`, `shutdown` and `idle`, the last when a voice with no
queue outlasts `idleTimeoutMs`. It publishes once per voice, after that
guild's `queue.deleted`.

## Register and unsubscribe

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

const unsubscribe = distube.on("queue.item.started", event => {
  console.log(event.guildId, event.item.song.name, event.timestamp);
});
unsubscribe();
```

`on` returns a function that removes the registration. Core delivers each event in a later microtask, in emit order.
A listener registered during delivery does not receive that event. A listener that throws or rejects affects
nothing else and is reported to `onDiagnostic` with stage `event.listener`.

## Ordering

`play` registers its queue synchronously, so `getQueue(guildId)` sees it before the first event arrives.
`queue.created` does not promise that the input resolves or the insertion succeeds.

Insertion publishes one `queue.item.added` for a Song or one `queue.playlist.added` for a Playlist. Playlist items
do not also emit individual events. `play` resolves after that commit. Preparation or playback can still fail, and
that reports `queue.item.failed` for the original item.

Each item gets at most one of `queue.item.finished` or `queue.item.failed`. A finished or skipped item enters
`queue.history`. Failed items do not. When the queue runs out, `queue.finished` fires, then `queue.deleted` with
reason `finished`. When the voice session is lost during a track, the order is `queue.item.failed`,
`queue.deleted` with reason `voice-loss`, then `voice.disconnected`.

Deleting a queue does not touch the voice's volume, filters, self-deaf or self-mute.

## Typed caller metadata

```ts
import { DisTube } from "distube";
import type { VoiceChannelTarget } from "distube";
import type { Adapter, Plugin } from "distube/integrations";

declare const adapter: Adapter;
declare const plugins: readonly Plugin[];
declare const channel: VoiceChannelTarget;

const distube = new DisTube<{ requestedBy: string }>({ adapter, plugins });
const unsubscribe = distube.on("queue.item.added", event => {
  console.log(event.item.metadata?.requestedBy);
});
await distube.play(channel, "a song query", { metadata: { requestedBy: "user-id" } });
unsubscribe();
```

Metadata is optional. Core stores the reference without reading, cloning or freezing it. Without a type parameter,
metadata is `unknown` and needs narrowing before property reads.
