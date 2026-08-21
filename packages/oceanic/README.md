# @distube/oceanic

Direct Oceanic Adapter for DisTube.

Its Player accepts the public `{ itemId, resource }` playback request, creates native audio only from the prepared
HTTP(S) resource URL, and terminalizes before connection teardown. Core—not this Adapter—disposes the source resource.

```ts
import { OceanicAdapter } from "@distube/oceanic";

declare const client: ConstructorParameters<typeof OceanicAdapter>[0];

const adapter = new OceanicAdapter(client);
```

Construct the class directly; there is no create-adapter alias or public `playerFactory` option. Concurrent stop calls
join one terminal teardown, every native cleanup unit is attempted once, and unrecoverable disconnects retire the
Player before reporting the active item failure.

## Local playback requirements

Use Node 22.12.0 or later. Install FFmpeg and expose `ffmpeg` on `PATH`, or set `FFMPEG_PATH` to its executable.
Install one Opus encoder: `@discordjs/opus` or `opusscript`.

FFmpeg receives the playable URL as a process argument. Another process running as the same operating-system user may inspect that argument while decoding is active. Public errors and captured decoder output redact the URL, and the engine refuses redirects after source validation.

The default engine checks both requirements before its first URL playback. If either is unavailable, playback rejects
with DisTube's `VOICE_FAILED` error and names the missing dependency.
