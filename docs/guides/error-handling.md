---
title: Error handling
description: DisTubeError codes and how to narrow them.
---

Public failures use `DisTubeError` with a string `code`. Core codes are the members of the exported `ErrorCode`
object; plugins export their own prefixed codes. Core preserves safe plugin errors. If a message or nested cause
contains a secret, core sanitizes the error graph while retaining its code and causal relationships.

| Code               | Meaning                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT` | Malformed input or configuration                                                                                                                         |
| `INVALID_STATE`    | Well-formed operation forbidden now: a deleted queue, a released voice, direct voice playback while a queue is attached, stale work or a disposed client |
| `ABORTED`          | Caller cancellation observed before commit                                                                                                               |
| `NO_RESULT`        | Every consulted source declined the query                                                                                                                |
| `SOURCE_FAILED`    | Provider resolution, malformed resolution results, preparation or explicit fallback exhaustion failed with a non-DisTube error                           |
| `VOICE_FAILED`     | Voice connection, backend effect or native cleanup failed                                                                                                |
| `PLUGIN_FAILED`    | Integration initialization or disposal failed                                                                                                            |
| `QUEUE_FAILED`     | Queue decision logic failed                                                                                                                              |
| `UNSUPPORTED`      | The engine cannot perform the capability: an undeclared resource kind, an unknown filter preset, seek on an engine whose `capabilities.seek` is false    |

```ts
import { DisTubeError, ErrorCode } from "distube";
import type { DisTubeQueue } from "distube";
import { YouTubeErrorCode } from "@distube/youtube";

declare const queue: DisTubeQueue;
declare const reply: (message: string) => Promise<void>;

try {
  await queue.add("https://youtu.be/example");
} catch (error) {
  if (DisTubeError.is(error, ErrorCode.INVALID_STATE)) await reply("The queue is gone.");
  else if (DisTubeError.is(error, YouTubeErrorCode.NOT_FOUND)) await reply("That video does not exist.");
  else if (DisTubeError.is(error, ErrorCode.NO_RESULT)) await reply("Nothing found.");
  else throw error;
}
```

`DisTubeError.is(error, code)` narrows `error` to `DisTubeError<typeof code>`. A `switch` on `error.code` needs a
default branch because plugin codes are open strings. Official plugin codes are `YouTubeErrorCode`
(`NOT_FOUND`, `UNAVAILABLE`, `AGE_RESTRICTED`, `RATE_LIMITED`), `SoundCloudErrorCode` (`NOT_FOUND`, `UNAVAILABLE`,
`RATE_LIMITED`) and `SpotifyErrorCode` (`NOT_FOUND`, `RATE_LIMITED`).

Use `INVALID_ARGUMENT` to correct input parsing and `INVALID_STATE` to explain why a valid command cannot run now.
Malformed constructor configuration rejects `INVALID_ARGUMENT`; integration lifecycle execution failures use
`PLUGIN_FAILED`. A malformed provider resolution result uses `SOURCE_FAILED` and retains its validation failure
as cause. Codes do not promise retryability. Inspect `cause` for the original provider or platform error without
exposing credentials or prepared URLs to users. There is one error class and no message template table.

## Cancellation

`play`, `queue.add`, `resolve`, `search`, `getSuggestions` and `voices.join` accept `options.signal`. An
already-aborted signal rejects `ABORTED` before allocation or source work. Cancellation observed before insertion
prevents that call's commit. Once insertion commits, cancellation cannot undo it. Other calls' items, reservations
and adopted voice remain owned by those calls.

The public rejection is a `DisTubeError`, never a raw abort value. An Error abort reason becomes `cause`; a non-Error
reason leaves `cause` undefined. A later provider abort exception does not replace the caller reason. Supersession
by stop or disposal uses `INVALID_STATE` and does not fabricate an item failure for work that never committed.

## Backend and cleanup failures

Backend-rendered settings commit only after acknowledgement. A failed filter mutation preserves the last acknowledged
set and rendering and rejects with the backend failure. Queue deletion does not touch voice settings.

Subsystem boundaries preserve an already matching safe error. An unsafe plugin error keeps its code and safe causal
relationships after sanitization. Other failures are wrapped once under the boundary's code with a safe cause.
Explicit fallback exhaustion retains attempted search and preparation causes in deterministic order through an
`AggregateError` cause. No provider cause is invented when none occurred.

Cleanup attempts every owned disposer even if another fails, aggregating failures under the accepting boundary.
A pending stop, leave or dispose caller receives its cleanup failure while logical state remains terminal.
Background failures use safe diagnostics. Cleanup cannot restore an old item, rewrite a terminal event or affect
replacement playback. A disposer that never settles remains pending; there is no fabricated successful timeout.
