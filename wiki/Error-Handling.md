# Error handling

Public failures use `DisTubeError` with a closed literal `code`:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Malformed input or configuration |
| `INVALID_STATE` | Well-formed operation forbidden now, stale work or a disposed owner |
| `ABORTED` | Caller cancellation observed before commit |
| `SOURCE_FAILED` | Provider resolution, malformed resolution results, preparation or explicit fallback exhaustion failed |
| `VOICE_FAILED` | Voice connection, backend effect or native cleanup failed |
| `PLUGIN_FAILED` | Integration initialization or disposal failed |
| `QUEUE_FAILED` | Queue decision logic failed |
| `UNSUPPORTED` | The engine cannot perform the requested capability, such as Eris seek |

<!-- verify-ts -->
```ts
import { DisTubeError } from "distube";
import type { DisTubeGuild } from "distube";

declare const queue: DisTubeGuild;
declare const reply: (message: string) => Promise<void>;

try {
  await queue.pause();
} catch (error) {
  if (!(error instanceof DisTubeError)) throw error;
  if (error.code === "INVALID_STATE") await reply("Nothing is playing.");
  else if (error.code === "VOICE_FAILED") await reply("The voice connection could not pause playback.");
  else throw error;
}
```

Use `INVALID_ARGUMENT` to correct input parsing and `INVALID_STATE` to explain why a valid command cannot run now.
Malformed constructor configuration rejects `INVALID_ARGUMENT`; integration lifecycle execution failures use
`PLUGIN_FAILED`. A malformed provider resolution result uses `SOURCE_FAILED` and retains its validation failure
as cause. Codes do not promise retryability. Inspect `cause` for the original provider or platform error without exposing
credentials or prepared URLs to users. There are no package-specific public error hierarchies or runtime error enums.

## Cancellation

`play`, `enqueue` and `resolve` accept `options.signal`. An already-aborted signal rejects `ABORTED` before allocation
or source work. Cancellation observed before insertion prevents that call's commit. Once insertion commits,
cancellation cannot undo it. Other calls' items, reservations and adopted voice remain owned by those calls.

The public rejection is a `DisTubeError`, never a raw abort value. An Error abort reason becomes `cause`; a non-Error
reason leaves `cause` undefined. A later provider abort exception does not replace the caller reason. Supersession
by stop or disposal uses `INVALID_STATE` and does not fabricate an item failure for work that never committed.

## Backend and cleanup failures

Backend-rendered settings commit only after acknowledgement. Failed filter replacement preserves the last
acknowledged state and rendering. Queue deletion also resets filters; if reset fails, the queue stays deleted,
prior acknowledged filter settings remain visible and cleanup reports the failure.

Subsystem boundaries preserve an already matching normalized error. Reclassification preserves the incompatible
error as its cause once. Explicit fallback exhaustion retains attempted search and preparation causes in deterministic
order through an `AggregateError` cause. No provider cause is invented when none occurred.

Cleanup attempts every owned disposer even if another fails, aggregating failures under the accepting boundary.
A pending stop, leave or dispose caller receives its cleanup failure while logical state remains terminal.
Background failures use safe diagnostics. Cleanup cannot restore an old item, rewrite a terminal event or affect
replacement playback. A disposer that never settles remains pending; there is no fabricated successful timeout.
