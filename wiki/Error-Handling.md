# Error handling

All public failures use `DisTubeError` and one of five codes:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid public input or configuration |
| `SOURCE_FAILED` | Resolution, original-source preparation, or explicit fallback exhaustion failed |
| `VOICE_FAILED` | Adapter creation, Player request/control/outcome, or native teardown failed |
| `PLUGIN_FAILED` | Plugin initialization or disposal failed |
| `QUEUE_FAILED` | Queue state, stale operation, destruction, or shutdown rejected work |

Check `error instanceof DisTubeError`, switch on `error.code`, and inspect `error.cause` for the original provider or
platform failure. There are no package-specific public error hierarchies.

Fallback exhaustion preserves target-search and candidate-preparation causes once in deterministic order through one
`AggregateError` cause. Cancellation superseded by stop/removal/destruction/shutdown produces no item terminal event.
Cleanup failure after an already committed item outcome is diagnostic and never rewrites playback history; a pending
stop, destroy, or shutdown caller receives its cleanup failure while logical state remains terminal.
