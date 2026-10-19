# Installation

Install only the packages the application uses:

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Alternatives are `@distube/oceanic` or `@distube/eris` for the platform Adapter and `@distube/spotify`,
`@distube/soundcloud`, or `@distube/lavalink` for media. Official local engines require system FFmpeg, one Opus
encoder (`@discordjs/opus` or `opusscript`), and one voice encryption implementation before first playback. The
discord.js and Oceanic adapters accept `sodium-native`, `sodium`, `libsodium-wrappers`, `@stablelib/xchacha20poly1305`, or
`@noble/ciphers`; Eris accepts `sodium-native` or `tweetnacl`. A missing encryption module fails the voice operation
with `VOICE_FAILED` naming the adapter and at least one accepted module, and holds no connection open. Official local engines accept `url`, `file` and Node `stream` resources. Files and explicitly seekable URLs
support seeking. Streams are one-shot and cannot seek. URL playback uses controlled Node HTTP(S) transport
piped into FFmpeg; authentication headers and signed URLs stay out of process arguments.

With an explicit remote engine, the adapter handles gateway membership without creating local audio or checking
FFmpeg, Opus or encryption prerequisites. Lavalink requires v4.2+ within major 4. Headerless URL playback needs
`trustedUrlLoading: true` and nodes enforcing equivalent destination policy. Authenticated URLs, local files and
streams are not accepted by Lavalink.

All published packages declare Node `>=22.12.0`; workspace development uses pinned Bun 1.4.3. Platform peer ranges
are discord.js `^14.26.0` with `@discordjs/voice ^0.19.0`, Oceanic `^1.14.0` with that same voice peer, and
Eris `^0.18.0`. Package peers remain required for installation even when local audio is not selected.
See [direct inputs](Direct-Inputs.md) for seek cost and cleanup, and [migration](../MIGRATION.md) for the
coordinated release plan. Packages release independently.
