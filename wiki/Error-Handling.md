# Error handling

All public failures use `DisTubeError` and one of five codes:

| Code | Meaning |
| --- | --- |
| `INVALID_ARGUMENT` | Invalid public input or configuration |
| `SOURCE_FAILED` | A source plugin accepted and failed the media request |
| `VOICE_FAILED` | Adapter or Player work failed |
| `PLUGIN_FAILED` | Plugin initialization or disposal failed |
| `QUEUE_FAILED` | Queue state, stale operation, destruction, or shutdown rejected work |

Check `error instanceof DisTubeError`, switch on `error.code`, and inspect `error.cause` for the original provider or
platform failure. There are no package-specific public error hierarchies.
