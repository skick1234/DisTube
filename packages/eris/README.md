# @distube/eris

Direct Eris Adapter for DisTube v6.

Its Player accepts the public `{ itemId, resource }` playback request, decodes the prepared HTTP(S) URL with FFmpeg,
and gives Eris PCM. It owns native listeners and connection teardown; core retains disposal ownership of the borrowed
source resource.

```ts
import { ErisAdapter } from "@distube/eris";

declare const client: ConstructorParameters<typeof ErisAdapter>[0];

const adapter = new ErisAdapter(client);
```

Construct the class directly; there is no create-adapter alias or public `playerFactory` option. Concurrent stop calls
join one terminal teardown, every native cleanup unit is attempted once, and unrecoverable disconnects retire the
Player before reporting the active item failure.

## Local playback requirements

Use Node 22.12.0 or later. Install FFmpeg and expose `ffmpeg` on `PATH`, or set `FFMPEG_PATH` to its executable.
Install one Opus encoder: `@discordjs/opus` or `opusscript`.

FFmpeg receives the playable URL as a process argument. Another process running as the same operating-system user may inspect that argument while decoding is active. Public errors and captured decoder output redact the URL, and the engine refuses redirects after source validation.

The default engine checks both requirements before its first URL playback. If either is unavailable, playback rejects
with DisTube's `VOICE_FAILED` error and names the missing dependency. The verified peer line is Eris 0.18. Seeking is
not supported and rejects with DisTube's `UNSUPPORTED` error.
