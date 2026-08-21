# @distube/discordjs

Direct discord.js Adapter for DisTube.

Its Player accepts the public `{ itemId, resource }` playback request, creates native audio only from the prepared
HTTP(S) resource URL, and terminalizes before connection teardown. Core—not this Adapter—disposes the source resource.

```ts
const adapter = new DiscordJSAdapter(client);
```

Construct the class directly; there is no create-adapter alias or public `playerFactory` option. Concurrent stop calls
join one terminal teardown, every native cleanup unit is attempted once, and unrecoverable disconnects retire the
Player before reporting the active item failure.

## Local playback requirements

Use Node 22.12.0 or later. Install FFmpeg and expose `ffmpeg` on `PATH`, or set `FFMPEG_PATH` to its executable.
Install one Opus encoder: `@discordjs/opus` or `opusscript`.

The default engine checks both requirements before its first URL playback. If either is unavailable, playback rejects
with DisTube's `VOICE_FAILED` error and names the missing dependency.
