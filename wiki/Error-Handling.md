# Error handling

All public failures use `DisTubeError` and one of six codes:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid public input or configuration |
| `SOURCE_FAILED` | Resolution, original-source preparation, or explicit fallback exhaustion failed |
| `VOICE_FAILED` | Voice session or Player request/control/outcome, or native teardown failed |
| `PLUGIN_FAILED` | Plugin initialization or disposal failed |
| `QUEUE_FAILED` | Queue state, stale operation, deletion, or shutdown rejected work |
| `UNSUPPORTED` | The active playback engine cannot express the requested effect (e.g. Eris seek) |

Check `error instanceof DisTubeError`, switch on `error.code`, and inspect `error.cause` for the original provider or
platform failure. There are no package-specific public error hierarchies.

## `reason`, on `INVALID_ARGUMENT` only

`INVALID_ARGUMENT` covers two different bugs, and `error.reason` separates them. It is set exactly when the code is
`INVALID_ARGUMENT` and `undefined` for the other five.

| `ErrorReason` | What went wrong | Examples |
| --- | --- | --- |
| `Argument` (`"argument"`) | The value the caller passed fails the documented contract | wrong type, unknown QueueItem ID, position past the end, negative volume |
| `State` (`"state"`) | The call is well formed but the current state forbids it | pausing when nothing is playing, removing the item that is playing, `previous()` with empty history |

That distinction is the one a bot acts on: `Argument` means fix the command parsing, `State` means tell the user the
queue is not in a position to do that.

```ts
import { ErrorCode, ErrorReason } from "distube";

try {
  await queue.previous();
} catch (error) {
  if (error instanceof DisTubeError && error.code === ErrorCode.INVALID_ARGUMENT) {
    await reply(error.reason === ErrorReason.State ? "Nothing has played yet." : "That is not a valid track.");
  }
}
```

A subsystem that replaces an incompatible code never copies the wrapped error's `reason` forward: the new code owns
the failure, and the original stays reachable through `cause` with its own `reason` intact.

## Cancellation

`play`, `enqueue`, and `resolve` accept an `options.signal`. Aborting it rejects that call with one `QUEUE_FAILED`
`DisTubeError` and leaves no QueueItem, resource, or success event behind. The raw abort reason is never the thrown
value, so a platform `DOMException` or `AbortError` cannot reach a caller that only handles `DisTubeError`; when the
reason is an Error it is preserved as `cause`, and when it is anything else there is no `cause` at all.
An existing DisTubeError is reused only when its code matches the subsystem that accepted responsibility; otherwise
the boundary creates the correct code and preserves the incompatible DisTubeError as `cause`.

Fallback exhaustion preserves target-search and candidate-preparation causes once in deterministic order through one
`AggregateError` cause. Cancellation superseded by stop/removal/destruction/shutdown produces no item terminal event.
Cleanup failure after an already committed item outcome is diagnostic and never rewrites playback history; a pending
stop, destroy, or shutdown caller receives its cleanup failure while logical state remains terminal.
Multiple queue, Player, resource, binding, or Plugin cleanup failures are attempted fully and returned once in stable
queue-registration/cleanup ownership order followed by reverse Plugin order.
