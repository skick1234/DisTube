# Events and timing

Subscribe to typed dotted names on the client:

| Event | Additional payload |
| --- | --- |
| `queue.created` | Registration of an empty queue |
| `queue.item.added` | `item` |
| `queue.playlist.added` | `playlist`, `items` |
| `queue.item.started` | `item` |
| `queue.item.finished` | `item` |
| `queue.item.failed` | `item`, `error` |
| `queue.finished` | Natural exhaustion |
| `queue.autoplay.failed` | `song`, `error` |
| `queue.deleted` | Terminal queue deletion |
| `voice.disconnected` | `guildId`, `timestamp`, `reason`, optional `error` |

Queue events carry `guildId`, the originating `queue`, captured `state` and commit `timestamp`. A later queue for
that guild is a different owner. Voice-only events do not manufacture a queue. Disconnect reasons are `"left"`,
`"platform"` and `"shutdown"`.

## Register and unsubscribe

<!-- verify-ts -->
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

## Playback and cleanup

Timestamps come from committing transitions. Events follow per-queue FIFO order; each occurrence receives at most
one finished/failed terminal event. Exhaustion publishes `queue.finished`, then `queue.deleted`. An unrecoverable
voice disconnect with an active item publishes `queue.item.failed`, `queue.deleted`, then `voice.disconnected`.
The voice disconnect event occurs once for that voice lifetime.

Queue deletion fences old work immediately. Its asynchronous cleanup includes filter reset. Deletion notification
does not by itself prove backend cleanup completed; await the terminal operation when cleanup completion matters.
Failed cleanup never rewrites a completed item outcome or revives a deleted queue.

## Typed caller metadata

<!-- verify-ts -->
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
