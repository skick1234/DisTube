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
