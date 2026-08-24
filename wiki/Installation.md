# Installation

Install only the packages the application uses:

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Alternatives are `@distube/oceanic` or `@distube/eris` for the platform Adapter and `@distube/spotify`,
`@distube/soundcloud`, or `@distube/lavalink` for media. Official local engines require system FFmpeg, one Opus
encoder (`@discordjs/opus` or `opusscript`), and one voice encryption implementation before first playback. The
discord.js and Oceanic adapters accept `sodium-native`, `libsodium-wrappers`, `@stablelib/xchacha20poly1305`, or
`@noble/ciphers`; Eris accepts `sodium-native` or `tweetnacl`. A missing encryption module fails the voice operation
with `VOICE_FAILED` naming the adapter and at least one accepted module, and holds no connection open. Every official
local engine declares `accepts` as `{"url"}`, so an `encoded` resource rejects with `UNSUPPORTED` before playback;
Lavalink is the engine that accepts `encoded`. Eris rejects seek with `UNSUPPORTED` because its native
voice API cannot seek a resource. Local FFmpeg receives the playable URL as a process argument. Another process
running as the same operating-system user may inspect that argument while decoding is active. Lavalink URL playback
requires `trustedUrlLoading: true` and nodes that enforce equivalent destination and redirect policy. Each package
releases independently. Use compatible v6 contracts and never install an SDK,
testkit, dedicated utilities package, or voice plugin for DisTube v6.
