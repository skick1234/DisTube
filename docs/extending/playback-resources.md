---
title: Playback resources
description: The resource shapes a plugin returns from stream, who disposes them and how engines differ.
sidebar:
  order: 2
---

This page is for plugin authors writing `stream`. By the end of it you will know which resource to return for your
provider's media, whether it can seek, and who cleans it up.

`stream(song, { signal })` returns a `PlaybackResource`, a plain object whose `kind` selects its shape. DisTube calls
the plugin named by `song.source`. Import the resource types from `distube/integrations`.

Just want to play a clip or an audio link? [Sound clips](../../popular-topics/soundboard/) and
[direct links](../../popular-topics/direct-links/) do that without a plugin of your own.

## Pick a kind

| Kind      | Required data                                                    | Seekable                           |
| --------- | ---------------------------------------------------------------- | ---------------------------------- |
| `url`     | Public absolute HTTP(S) `url`, fetched without headers           | When the server serves byte ranges |
| `file`    | Absolute `path`                                                  | Yes                                |
| `stream`  | Node `Readable` in `stream`                                      | Never; one shot                    |
| `reader`  | `size`, `read(start, end, signal)`, optional `container`         | Yes                                |
| `timed`   | `open(seconds, signal)`, optional `container`                    | Yes                                |
| `encoded` | `format` and `encoded`, playable only by the engine that made it | Only with `seekable: true`         |

The engine fetches a `url` without headers. Media whose requests need headers, such as authenticated HTTP, is a `reader` or
`timed` resource instead.

`reader` hands out byte ranges. `read(start, end, signal)` returns bytes `start` through `end` inclusive, and `signal`
aborts when the engine no longer needs them. `timed` is for media that can only start at a time. `open(seconds, signal)`
returns the container header, then media from at or before `seconds`.

`container`, `"webm"` or `"mp4"`, makes the built-in engine open that container without looking at the bytes. Leave it
out for anything else. The engine then identifies the format from the first bytes, and accepts Matroska or WebM, MP4,
Ogg, MP3, FLAC, WAV or AAC.

:::note
An MP3 has no seek index. A seek on an MP3 `reader` reads every byte from the start of the file to the target.
:::

A player rejects a kind it cannot play with `UNSUPPORTED`. Seek errors are on the
[queue reference](../../reference/queue/).

## Ownership

Return a new resource from every `stream` call, because a readable can only be read once. DisTube disposes the
resource exactly once, after the track ends or when it drops a prepared item before playback. It does that by calling
the optional `dispose()`, and for a `stream` resource it also destroys the readable.

Files and plain URL values need no disposer. Supply `dispose` for extra state you own, such as a temporary file:

```ts
import { rm } from "node:fs/promises";
import type { PlaybackResource } from "distube/integrations";

declare function downloadToTempFile(url: string, signal: AbortSignal): Promise<string>;

export async function prepareFromTempFile(url: string, signal: AbortSignal): Promise<PlaybackResource> {
  const path = await downloadToTempFile(url, signal);
  return { kind: "file", path, dispose: () => rm(path, { force: true }) };
}
```

DisTube reports a disposer that fails through `onDiagnostic`.

:::caution
Keep private paths and credentials out of Song fields, `pluginData` and events. The resource is the only place they
belong.
:::

## Engines

The built-in engine plays `url`, `file`, `stream`, `reader` and `timed` resources, not `encoded` ones. Its read-ahead
and Opus settings come from the [`engine` option](../../reference/options/).

The bytes must be one audio file in Matroska or WebM, MP4, Ogg, MP3, FLAC, WAV or AAC. A `url` whose response has an
HLS content type, such as `application/vnd.apple.mpegurl`, is the exception. The engine plays that playlist and fetches
its segments over HTTP(S), accepting MPEG-TS, MP4, AAC and MP3 segments. A DASH manifest rejects, and so does an HLS
playlist passed as a `stream`. Any other format rejects `SOURCE_FAILED`.

An engine plugin such as Lavalink replaces the built-in engine. It prepares each Song itself, usually as an `encoded`
resource, so DisTube calls no plugin's `stream` for it. An operation the engine cannot perform rejects `UNSUPPORTED`. See
the [Lavalink page](../../plugins/lavalink/) and [adapter authoring](../adapter-authoring/#engine-plugins).

## Next

To write the engine that plays these resources, or to support a new platform, read
[adapter authoring](../adapter-authoring/).
