# Installation

Install only the packages the application uses:

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Alternatives are `@distube/oceanic` or `@distube/eris` for the platform Adapter and `@distube/spotify`,
`@distube/soundcloud`, or `@distube/lavalink` for media. Official local engines require system FFmpeg plus
`@discordjs/opus` or `opusscript` before first playback. Eris rejects seek with `UNSUPPORTED` because its native
voice API cannot seek a resource. Local FFmpeg receives the playable URL as a process argument. Another process
running as the same operating-system user may inspect that argument while decoding is active. Lavalink URL playback
requires `trustedUrlLoading: true` and nodes that enforce equivalent destination and redirect policy. Each package
releases independently. Use compatible v6 contracts and never install an SDK,
testkit, dedicated utilities package, or voice plugin for DisTube v6.
