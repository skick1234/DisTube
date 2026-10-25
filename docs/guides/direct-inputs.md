---
title: Clips and playback resources
description: Play application-owned clips as Songs, and the resource shapes a plugin returns from stream.
sidebar:
  order: 4
---

Every track plays through the guild queue. A sound clip is a Song whose plugin has only a `stream` method. The
plugin maps the clip ID to a fresh resource each time core asks for it.

```ts
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { DisTube, Song } from "distube";
import type { VoiceChannelTarget } from "distube";
import type { Adapter, Plugin } from "distube/integrations";

declare const adapter: Adapter;
declare const channel: VoiceChannelTarget;
declare const music: Plugin;

const clips: Plugin = {
  name: "clips",
  async stream(song) {
    const path = resolve("clips", `${song.id}.mp3`);
    return song.id === "live" ? { kind: "stream", stream: createReadStream(path) } : { kind: "file", path };
  },
};

const distube = new DisTube({ adapter, plugins: [music, clips] });

const welcome = new Song({ source: "clips", id: "welcome", name: "Welcome", url: "https://bot.example/clips/welcome" });
const wasPlaying = distube.getQueue(channel.guildId)?.current !== undefined;
const queue = await distube.play(channel, welcome, { next: true });
if (wasPlaying) await queue.skip();
```

`distube.play(channel, song, { next: true })` joins the channel, creates the queue if there is none and inserts the
clip at the front of `upcoming`. Without a `skip`, the clip starts when the current item ends. When music is playing, `queue.skip()` moves the
current item to history and starts the clip at once. Skip only in that case: in an idle queue the clip is already
the current item, and a skip would drop it. The clip is a normal queue item, so `queue.item.started`,
`queue.item.finished` and `queue.item.failed` describe it, and `queue.add(clip, { next: true })` does the same on a
queue you already hold.

A Song needs `source`, `id`, `name` and `url`. Core only passes a Song to the plugin named by its `source`. A path
passed to `distube.play` as a string is a search query, not a file, so build the Song yourself. Keep private paths
and credentials out of Song fields, `pluginData` and events.

To stop the clip and everything after it, `await queue.stop()`. A track ends as `finished` when the media plays to
its end. A failed preparation or playback publishes `queue.item.failed` and the queue moves on.

## Resources

`stream(song, { signal })` returns a `PlaybackResource`. It is a plain object whose `kind` selects the shape.

| Kind      | Required data                                                    | Seekable                   |
| --------- | ---------------------------------------------------------------- | -------------------------- |
| `url`     | Public absolute HTTP(S) `url`, fetched without headers           | Never                      |
| `file`    | Absolute `path`                                                  | Yes                        |
| `stream`  | Node `Readable` in `stream`                                      | Never; one shot            |
| `reader`  | `size`, `container`, and `read(start, end, signal)`              | Yes                        |
| `timed`   | `container`, and `open(seconds, signal)`                         | Yes                        |
| `encoded` | `format` and `encoded`, playable only by the engine that made it | Only with `seekable: true` |

The resource union is exported as types from `distube/integrations`. Authenticated or seekable HTTP media is a
`reader` or `timed` resource. `queue.seek(seconds)` on a started item rejects `UNSUPPORTED` when the resource or the
engine cannot seek, and `INVALID_ARGUMENT` for a negative or non-finite value. A Player rejects a kind it cannot
play with `UNSUPPORTED`, and the built-in engine does not play `encoded` resources.

A queue also rejects a seek beyond a known Song duration with `INVALID_ARGUMENT`. A missing duration does not
block a seek.

## Ownership

Return a new resource from every `stream` call. A readable is single-use. Core disposes the resource exactly once,
after the track ends or when it drops a prepared item before playback, by calling the optional `dispose()`. Files
and plain URL values need no disposer. Supply `dispose` for extra owned state, such as a temporary file. A failing
disposer is reported through `onDiagnostic`.

## Built-in engine

The built-in engine plays `url`, `file`, `stream`, `reader` and `timed` resources. Its read-ahead and Opus settings
come from the `engine` option, see the [guide](../guide/#options). Streams and URLs reject `seek` with
`UNSUPPORTED` before they change playback.

## Remote playback

Put an engine plugin such as Lavalink in `plugins`. The adapter keeps the gateway session and passes its
credentials to the engine, and the built-in engine is not created. Such an engine prepares each Song itself,
usually as an `encoded` resource, so a clip plugin's `stream` is never called for it. An operation the engine cannot
perform rejects `UNSUPPORTED`. See the [Lavalink page](../../plugins/lavalink/).
