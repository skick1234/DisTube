---
title: Playback resources
description: The resource shapes a plugin returns from stream, who disposes them and how engines differ.
sidebar:
  order: 2
---

`stream(song, { signal })` returns a `PlaybackResource`, a plain object whose `kind` selects the shape. DisTube calls
the plugin named by `song.source`. To play a clip, see [soundboard](../../recipes/soundboard/). To play audio links
and attachments, see [direct links](../../recipes/direct-links/).

| Kind      | Required data                                                    | Seekable                   |
| --------- | ---------------------------------------------------------------- | -------------------------- |
| `url`     | Public absolute HTTP(S) `url`, fetched without headers           | Never                      |
| `file`    | Absolute `path`                                                  | Yes                        |
| `stream`  | Node `Readable` in `stream`                                      | Never; one shot            |
| `reader`  | `size`, `read(start, end, signal)`, optional `container`         | Yes                        |
| `timed`   | `open(seconds, signal)`, optional `container`                    | Yes                        |
| `encoded` | `format` and `encoded`, playable only by the engine that made it | Only with `seekable: true` |

Import the resource types from `distube/integrations`. Authenticated or seekable HTTP media is a `reader` or `timed`
resource.

`container` (`"webm"` or `"mp4"`) makes the built-in engine open that container without looking at the bytes. Leave it
out for anything else: the engine identifies the format from the first bytes and accepts Matroska or WebM, MP4, Ogg,
MP3, FLAC, WAV or AAC. An MP3 has no seek index, so a seek on an MP3 `reader` reads every byte from the start of the
file to the target.

Seek errors are on the [queue reference](../../reference/queue/). A player rejects a kind it cannot play with
`UNSUPPORTED`.

## Ownership

Return a new resource from every `stream` call, because a readable is single-use. DisTube disposes the resource
exactly once, after the track ends or when it drops a prepared item before playback, by calling the optional
`dispose()`. Files and plain URL values need no disposer. Supply `dispose` for extra owned state, such as a temporary
file. A failing disposer is reported through `onDiagnostic`.

Keep private paths and credentials out of Song fields, `pluginData` and events.

## Engines

The built-in engine plays `url`, `file`, `stream`, `reader` and `timed` resources, not `encoded` ones. Its read-ahead
and Opus settings come from the [`engine` option](../../reference/options/).

The bytes must be one audio file in Matroska or WebM, MP4, Ogg, MP3, FLAC, WAV or AAC. A `url` whose response has an HLS
content type, such as `application/vnd.apple.mpegurl`, is the exception: the engine plays that playlist and fetches its
segments over HTTP(S), accepting MPEG-TS, MP4, AAC and MP3 segments. A DASH manifest rejects, and so does an HLS
playlist passed as a `stream`. Any other format rejects `SOURCE_FAILED`.

An engine plugin such as Lavalink replaces the built-in engine. It prepares each Song itself, usually as an `encoded`
resource, so no plugin's `stream` is called for it. An operation the engine cannot perform rejects `UNSUPPORTED`. See
the [Lavalink page](../../plugins/lavalink/) and [adapter authoring](../adapter-authoring/#engine-plugins).
