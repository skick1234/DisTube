# Frequently asked questions

## Where is `play()`?

Use `queue.enqueue()`. DisTube v6 has one insertion model.

## How do I search?

Retain the typed source plugin instance and call its `search()` method directly.

## How do I move voice channels?

Queue bindings are stable. Destroy the old queue and create a queue for the new guild/channel binding.

## Where are filters, repeat, autoplay, and snapshots?

They are not part of the DisTube v6 API.

## Which package handles voice?

The selected platform Adapter supplies the complete Player. There is no separate voice plugin.

Official choices are `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris`. Eris 0.18 needs an Opus
implementation for voice and intentionally rejects seek because its supported voice API cannot seek a resource.

## Does DisTube send Discord replies?

No. Core and adapters publish state/events; application code sends user-facing messages.
