# Events and timing

DisTube emits ten client-wide events through the string-valued `Events` enum: `QueueCreated`, `QueueItemAdded`,
`QueuePlaylistAdded`, `QueueItemStarted`, `QueueItemFinished`, `QueueItemFailed`, `QueueFinished`,
`QueueAutoplayFailed`, `QueueDeleted`, and `VoiceDisconnected`. Queue events carry `guildId`, the `queue`, and
`timestamp`; item events also carry `item`, playlist additions carry `playlist` and `items`, failures carry `error`,
and `VoiceDisconnected` carries a `reason` (`left | platform | shutdown`).

Each timestamp is captured by the transition that commits the event, not when a detached listener later runs. Events
publish after the corresponding state commit, preserve per-queue FIFO order, and produce at most one terminal
finished/failed event per QueueItem occurrence. Exhaustion publishes `QueueFinished` and then `QueueDeleted`. An
unrecoverable Voice disconnect with an active item publishes `QueueItemFailed`, then `QueueDeleted`, then
`VoiceDisconnected`. `VoiceDisconnected` publishes once per Voice. Listener failures are isolated and routed to
`onDiagnostic`.

## Registering and removing listeners

`on`, `once`, `off`, and `removeAllListeners` all return the client, so they chain. `off` takes the function you
passed, which means it removes a `once` registration too. Each `off` call removes one registration, so a listener
added twice needs two calls. `removeAllListeners(name)` clears one event; with no argument it clears every event.

```ts
import type { DisTube, DisTubeEventMap } from "distube";

declare const distube: DisTube;
declare const log: (message: string) => void;

const onStarted = (event: DisTubeEventMap["queue.item.started"]) => log(event.item.song.title);

distube.once("queue.item.started", onStarted).off("queue.item.started", onStarted); // never fires
distube.removeAllListeners("queue.item.failed");
distube.removeAllListeners();
```

A listener registered while an event is being delivered does not receive that event; delivery works from the list as
it stood when `emit` ran.

## Typed caller metadata

`DisTube` takes one optional type parameter naming the shape of `options.metadata`. It threads to every QueueItem,
GuildQueue, Voice, and event payload the client hands back, so the reads below need no cast:

```ts
import { DisTube } from "distube";
import type { Adapter, PlayTarget, Plugin } from "distube";

declare const adapter: Adapter;
declare const plugins: readonly Plugin[];
declare const target: PlayTarget;
declare const url: string;
declare const user: Readonly<{ id: string }>;
declare const log: (message: string) => void;

const distube = new DisTube<{ requestedBy: string }>({ adapter, plugins });

distube.on("queue.item.added", event => log(event.item.metadata.requestedBy));
await distube.play(target, url, { metadata: { requestedBy: user.id } });
```

Core never reads, copies, or validates the value; the type parameter is the whole contract. Omit it and every
`metadata` is `unknown`, which needs narrowing before a property read but still accepts any value on the way in.
