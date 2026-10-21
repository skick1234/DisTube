---
title: Direct playback inputs
description: Play files, URLs and streams directly on a voice, and what ends a track.
sidebar:
  order: 4
---

Music commands use `const queue = await distube.play(channel, query)` and queue controls. Direct playback suits an
application-owned clip or audio the bot generates. Join a voice without a queue, then call `voice.play`.

```ts
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type { DisTube, VoiceChannelTarget } from "distube";
import type { PlaybackResource } from "distube/integrations";

declare const distube: DisTube;
declare const channel: VoiceChannelTarget;
declare const accessToken: string;

const voice = await distube.voices.join(channel);
const clipPath = resolve("clips/welcome.mp3");

const end = await voice.play({ kind: "file", path: clipPath }, { onStart: () => console.log("audible") });
console.log(end.reason);

const authenticated: PlaybackResource = {
  kind: "url",
  url: "https://audio.example/private.mp3",
  headers: { Authorization: `Bearer ${accessToken}` },
  seekable: true,
};
await voice.play(authenticated, { signal: AbortSignal.timeout(30_000) });

await voice.play({ kind: "stream", stream: createReadStream(clipPath) });
await voice.leave();
```

`voice.play(resource, { signal?, onStart? })` returns a promise that settles when the track ends.

| Result                   | Meaning                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `{ reason: "finished" }` | The media played to its end.                                   |
| `{ reason: "stopped" }`  | `voice.stop()`, or the signal aborted after the track started. |
| `{ reason: "replaced" }` | Another `voice.play` replaced this track.                      |
| Rejection `ABORTED`      | The signal aborted before the track started.                   |
| Rejection `VOICE_FAILED` | The Player failed, or the session was lost.                    |

The last writer wins. A second `voice.play` ends the first call as `replaced` before the new track starts. If a
queue was driving the voice, the queue is deleted with `queue.deleted` reason `replaced`, so a clip never gets cut
off by the queue. Queue `skip`, `jump` and `previous` stop only the track the queue started.

A path passed to `distube.play` is a search query, not a file. To queue clips, write a small plugin that maps clip
IDs to fresh resources in `stream`. Keep private paths and credentials out of Song fields, `pluginData` and events.

| Kind      | Required data                                                    | Seekable                   |
| --------- | ---------------------------------------------------------------- | -------------------------- |
| `url`     | Absolute HTTP(S) `url`; optional `headers`                       | Only with `seekable: true` |
| `file`    | Absolute `path`                                                  | Yes                        |
| `stream`  | Node `Readable` in `stream`                                      | Never; one shot            |
| `reader`  | `size`, `container`, and `read(start, end, signal)`              | Yes                        |
| `timed`   | `container`, and `open(seconds, signal)`                         | Yes                        |
| `encoded` | `format` and `encoded`, playable only by the engine that made it | Only with `seekable: true` |

The resource union is exported as types from `distube/integrations`. Resources are plain objects. `voice.seek(seconds)` on a started track
rejects `UNSUPPORTED` when the active resource cannot seek or the engine cannot, and `INVALID_ARGUMENT` for a
negative or non-finite value. A Player rejects a kind it cannot play with `UNSUPPORTED`, and the built-in engine
does not play `encoded` resources.

## Ownership

Create a new resource for every `voice.play`. A readable is single-use. `voice.play` disposes the resource once
the Player stops reading it: it calls the optional `dispose()`, and a `replaced` call settles without waiting for
that disposal. Files and plain URL values need no disposer. Supply `dispose` for extra owned state, such as a
temporary file. A failing disposer is reported through `onDiagnostic`.

## Built-in engine

The built-in engine plays `url`, `file`, `stream`, `reader` and `timed` resources. Its read-ahead and Opus settings
come from the `engine` option, see the [guide](../guide/#options). Streams and non-seekable URLs reject `seek` with
`UNSUPPORTED` before they change playback.

A queue also rejects a seek beyond a known Song duration with `INVALID_ARGUMENT`. A missing duration does not
block a seek.

## Remote playback

Put an engine plugin such as Lavalink in `plugins`. The adapter keeps the gateway session and passes its
credentials to the engine, and the built-in engine is not created. Such an engine prepares each Song itself,
usually as an `encoded` resource, so direct `voice.play` of `file` and `stream` resources works only if that engine
supports them. An operation it cannot perform rejects `UNSUPPORTED`. See the [Lavalink page](../../plugins/lavalink/).
