# Installation

Install only the packages the application uses:

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

Alternatives are `@distube/oceanic` or `@distube/eris` for the platform Adapter and `@distube/spotify` or
`@distube/soundcloud` for media. Eris 0.18 voice playback requires `opusscript` or `@discordjs/opus`; install
`ffmpeg-static` when inputs require transcoding. Its Player intentionally rejects seek because Eris exposes no
supported seek operation. Each package releases independently. Use compatible v6 contracts and never install an SDK,
testkit, dedicated utilities package, or voice plugin for DisTube v6.
