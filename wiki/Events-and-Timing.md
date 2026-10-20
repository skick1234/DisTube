# Events and timing

Subscribe to typed dotted names on the client:

| Event                   | Additional payload                               |
| ----------------------- | ------------------------------------------------ |
| `queue.created`         | Registration of an empty queue                   |
| `queue.item.added`      | `item`                                           |
| `queue.playlist.added`  | `playlist`, `items`                              |
| `queue.item.started`    | `item`                                           |
| `queue.item.finished`   | `item`                                           |
| `queue.item.failed`     | `item`, `error`                                  |
| `queue.history.added`   | `item`, after the item's terminal outcome event  |
| `queue.finished`        | Natural exhaustion                               |
| `queue.autoplay.failed` | `song`, `error`                                  |
| `queue.deleted`         | Terminal queue deletion                          |
| `voice.track.started`   | `voice`, optional `itemId`                       |
| `voice.track.finished`  | `voice`, optional `itemId`                       |
| `voice.track.failed`    | `voice`, optional `itemId`, `error`              |
| `voice.disconnected`    | `voice`, `channelId`, `reason`, optional `error` |

Queue events carry `guildId`, the originating `queue`, captured `state` (`current`, `upcoming`, `history`, `status`,
`repeat`, `autoplay`) and commit `timestamp`. A later queue for that guild is a different owner. Voice events carry
`guildId`, `voice` and `timestamp` and never manufacture a queue. Disconnect reasons are `"left"`, `"platform"` and
`"shutdown"`.

## Register and unsubscribe

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

const unsubscribe = distube.on("queue.item.started", event => {
  console.log(event.guildId, event.item.song.name, event.timestamp);
});
unsubscribe();
```

Each `on` call returns a function removing that registration. Retain it for application cleanup. Event delivery uses
a captured listener list; registration during delivery does not receive that event. Listener throws and rejected
promises are isolated and sent to `onDiagnostic`, whose own failures cannot affect playback.

## Registration is visible before resolution

`play` validates shallow inputs and synchronously registers and reserves its queue before returning its promise.
`getQueue(guildId)` sees it immediately. The creation event is delivered after that initial invocation, once the
first reservation is already established. It does not promise that a source recognized the input or insertion worked.

Insertion publishes one `queue.item.added` for a Song or one `queue.playlist.added` for a Playlist. Playlist items do
not also emit individual addition events. `play` resolves after that commit. Playback preparation can still fail,
reported through `queue.item.failed` for the original occurrence.

Failed first work that leaves no items or other reservations produces `queue.deleted` after registration, without
fabricated item events or `queue.finished`. An outstanding explicit insertion prevents natural exhaustion.

## Voice track events and queue events

The voice publishes `voice.track.started` after the backend acknowledges a track, then exactly one of
`voice.track.finished` or `voice.track.failed`. When a queue drives the voice, the queue derives its own
`queue.item.started`, `queue.item.finished` or `queue.item.failed` from those, so the voice event for an item always
precedes the queue event for the same item, and `itemId` on the voice event equals `item.id` on the queue event. A
direct `voice.play` without a queue publishes only voice track events, with no `itemId` unless the caller passed one.

## Playback and cleanup

Timestamps come from committing transitions. Events follow per-guild FIFO order; each occurrence receives at most
one finished/failed terminal event, followed by `queue.history.added` when it enters history (failed items do not).
Exhaustion publishes `queue.finished`, then `queue.deleted`. An unrecoverable voice disconnect with an active item
publishes `voice.track.failed`, `queue.item.failed`, `queue.deleted`, then `voice.disconnected`. The voice
disconnect event occurs once for that voice lifetime.

Queue deletion detaches from the voice and fences old work immediately. It does not touch volume, filters, self-deaf
or self-mute. Deletion notification does not by itself prove backend cleanup completed; await the terminal operation
when cleanup completion matters. Failed cleanup never rewrites a completed item outcome or revives a deleted queue.

## Typed caller metadata

```ts
import { DisTube } from "distube";
import type { VoiceChannelTarget } from "distube";
import type { Adapter, SourcePlugin } from "distube/integrations";

declare const adapter: Adapter;
declare const sources: readonly SourcePlugin[];
declare const channel: VoiceChannelTarget;

const distube = new DisTube<{ requestedBy: string }>({ adapter, sources });
const unsubscribe = distube.on("queue.item.added", event => {
  console.log(event.item.metadata?.requestedBy);
});
await distube.play(channel, "a song query", { metadata: { requestedBy: "user-id" } });
unsubscribe();
```

Metadata is optional. Core stores the caller reference without reading, cloning or freezing its contents. The
occurrence property binding is readonly; mutations to the supplied object remain visible. Without a type parameter,
metadata is `unknown` and needs narrowing before property reads.
