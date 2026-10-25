---
title: Error handling
description: DisTubeError codes and how to narrow them.
sidebar:
  order: 6
---

Public failures use `DisTubeError` with a string `code` from the exported `ErrorCode` object, an optional `cause`,
and an optional `source`. `source` names the plugin a failure came from.

Two more fields replace message parsing:

- `query` is the text that found nothing. Core sets it only when every plugin was exhausted: the query you
  passed, a URL no plugin resolved, or the name-and-artist search it ran for a Spotify track. A plugin's own
  `NO_RESULT` for an empty playlist has no `query` and has `media` `"playlist"`.
- `media` is `"song"` or `"playlist"`, the kind of media a failed provider lookup was for. The official plugins
  set it on the provider's answer to that lookup. A Spotify album or artist counts as `"playlist"`. Search,
  autoplay, malformed responses and refused credentials (HTTP 401) have none.

| Code               | Meaning                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT` | Malformed input or configuration                                                                               |
| `INVALID_STATE`    | A valid operation that is not allowed now: a deleted queue, a released voice, stale work or a disposed client  |
| `ABORTED`          | Caller cancellation observed before commit                                                                     |
| `NO_RESULT`        | Every consulted plugin declined                                                                                |
| `NOT_FOUND`        | The provider says the media does not exist                                                                     |
| `UNAVAILABLE`      | The media exists but cannot be played, for example private, age restricted or region locked                    |
| `RATE_LIMITED`     | The provider throttled the request                                                                             |
| `SOURCE_FAILED`    | A plugin failed in any other way, or returned something malformed                                              |
| `VOICE_FAILED`     | The voice connection, the Player or native cleanup failed                                                      |
| `UNSUPPORTED`      | The engine or plugin cannot do this: an unknown filter preset, seek on a stream, search on a plugin without it |

```ts
import { DisTubeError, ErrorCode } from "distube";
import type { DisTubeQueue } from "distube";

declare const queue: DisTubeQueue;
declare const reply: (message: string) => Promise<void>;

try {
  await queue.add("https://youtu.be/example");
} catch (error) {
  if (DisTubeError.is(error, ErrorCode.INVALID_STATE)) await reply("The queue is gone.");
  else if (DisTubeError.is(error, ErrorCode.NOT_FOUND) && error.media === "playlist") await reply("No such playlist.");
  else if (DisTubeError.is(error, ErrorCode.NOT_FOUND)) await reply("That video does not exist.");
  else if (DisTubeError.is(error, ErrorCode.UNAVAILABLE)) await reply("That video cannot be played.");
  else if (DisTubeError.is(error, ErrorCode.NO_RESULT) && error.media === "playlist")
    await reply("That playlist is empty.");
  else if (DisTubeError.is(error, ErrorCode.NO_RESULT)) await reply(`Nothing found for ${error.query}.`);
  else throw error;
}
```

`DisTubeError.is(error, code)` narrows `error` to `DisTubeError<typeof code>`. Without a code it narrows to any
`DisTubeError`. Plugins use the same core codes, so the check is identical for every provider. Read `error.source`
to tell which plugin failed, for example `"youtube"`.

Use `INVALID_ARGUMENT` to correct input and `INVALID_STATE` to explain why a valid command cannot run now. Codes do
not promise retryability, except that `RATE_LIMITED` usually means waiting. Inspect `cause` for the original
provider or platform error. Do not show it to users, because a provider error can contain request details.

## Plugin errors

A `DisTubeError` thrown by a plugin reaches the caller unchanged. Any other throw becomes `SOURCE_FAILED` with the
original as `cause` and `source` set to the plugin's name. Core does not scrub messages. Plugins keep signed URLs,
tokens and headers out of the errors they build.

## Cancellation

`play`, `queue.add`, `resolve`, `search`, `suggest` and `voices.join` accept `signal`. An already-aborted
signal rejects `ABORTED` before any work starts. Cancellation before the insertion commits prevents it. After it
commits, cancellation cannot undo it. An Error abort reason becomes `cause`. Deleting the queue or disposing the
client supersedes pending work with `INVALID_STATE`.

A `signal` passed to a plugin's `stream` or `prepare` aborts when the item is skipped, jumped over or its queue is
deleted. Throw the signal's reason, for example with `signal.throwIfAborted()`.

## Backend and cleanup failures

A filter or volume change commits only after the Player acknowledges it. A failure leaves the last
acknowledged value and rejects with `VOICE_FAILED`, or `UNSUPPORTED` when the engine cannot do it. A filter chain the built-in engine cannot build rejects
`INVALID_ARGUMENT` and keeps the previous chain.

`dispose()` and `leave()` attempt every cleanup even if one fails. Failures reject one `AggregateError` inside a
`DisTubeError`. The code is `VOICE_FAILED` when a voice or queue cleanup failed, otherwise `SOURCE_FAILED`. A
failed cleanup never revives a deleted queue or rewrites an item's outcome.
