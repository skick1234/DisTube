# Events and timing

DisTube emits six client-wide events: `queue.created`, `queue.item.added`, `queue.item.started`,
`queue.item.finished`, `queue.item.failed`, and `queue.destroyed`. Every payload has `queueId` and `timestamp`; item
events also have `item`, and failed events have `error`.

Each timestamp is captured by the transition that commits the event, not when a detached listener later runs. Events
publish after the corresponding state commit, preserve per-queue FIFO order, and produce at most one terminal
finished/failed event per QueueItem occurrence. Listener failures are isolated and routed to `onDiagnostic`.
