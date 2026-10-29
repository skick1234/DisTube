---
title: Errors
description: DisTubeError codes, how to narrow them, cancellation and cleanup failures.
sidebar:
  order: 5
---

Public failures use `DisTubeError`. It has a string `code` from the exported `ErrorCode` object, an optional
`cause` and an optional `source` naming the plugin a failure came from, for example `"youtube"`.

## Codes

| Code                 | Meaning                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`   | Malformed input or configuration                                                                                      |
| `INVALID_STATE`      | A valid operation that is not allowed now: a deleted queue, a released voice, stale work or a disposed client         |
| `ABORTED`            | The caller cancelled before the work committed                                                                        |
| `NO_RESULT`          | Every consulted plugin declined                                                                                       |
| `NOT_FOUND`          | The provider says the media does not exist                                                                            |
| `UNAVAILABLE`        | The media exists but cannot be played, for example private or region locked                                           |
| `RATE_LIMITED`       | The provider throttled the request                                                                                    |
| `SOURCE_FAILED`      | A plugin failed in any other way, or returned something malformed                                                     |
| `VOICE_FAILED`       | The voice connection, the player or native cleanup failed                                                             |
| `VOICE_DISCONNECTED` | An established voice connection dropped beyond the adapter's recovery, on `voice.disconnected` with reason `platform` |
| `UNSUPPORTED`        | The engine or plugin cannot do this: an unknown filter preset, seek on a stream, search on a plugin without it        |
| `AGE_RESTRICTED`     | The call did not allow age-restricted media, or the provider refused it without an age-verified account               |

Use `INVALID_ARGUMENT` to ask the user to correct input and `INVALID_STATE` to explain why a valid command cannot run
now. No code promises that a retry succeeds. `RATE_LIMITED` usually clears after a wait.

Two fields replace message parsing:

- `query` is the text that found nothing. DisTube sets it only after every plugin declined: the query you passed, a
  URL no plugin resolved, or the name-and-artist search it ran for a Spotify track. A plugin's own `NO_RESULT` for an
  empty playlist has no `query` and has `media` `"playlist"`. The official plugins set `media` from the provider's
  answer to the lookup.
- `media` is `"song"` or `"playlist"`, the kind of media a failed provider lookup was for. A Spotify album or artist
  counts as `"playlist"`. Search, autoplay, malformed responses and refused credentials (HTTP 401) have none.

## Narrowing

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
`DisTubeError`. Plugins use the same codes, so one check works for every provider. Inspect `cause` for the original
provider or platform error, but do not show it to users, because it can contain request details.

Errors from playback arrive on `queue.item.failed`, not from `play`. See [events](../events/).

## Plugin errors

Core wraps every plugin call. A `DisTubeError` with a code other than `INVALID_ARGUMENT`, `INVALID_STATE` or
`ABORTED` reaches the caller unchanged, such as `NOT_FOUND`, `UNAVAILABLE` or `RATE_LIMITED`. Those three codes
describe the caller's input, the queue or the caller's cancellation, so a plugin that throws one gets `SOURCE_FAILED`
with the original as `cause` and `source` set to the plugin's name. Any other throw is wrapped the same way. When the
caller's own signal aborted, the error is `ABORTED` instead. DisTube does not scrub messages. Plugins keep signed URLs,
tokens and headers out of the errors they build.

## Bot check

YouTube sometimes answers "Sign in to confirm you're not a bot", which is common on datacenter and VPS addresses.
`@distube/youtube` raises it as `UNAVAILABLE` with `error.source` `"youtube"` and a `YtdlError` as `cause`, whose `code`
is `BOT_CHECK`.

```ts
import { YtdlError } from "@distube/ytdl-core";
import type { DisTube } from "distube";

declare const distube: DisTube;

distube.on("queue.item.failed", ({ error }) => {
  if (YtdlError.is(error.cause, "BOT_CHECK")) console.error("YouTube wants a signed-in cookie or a PO token.");
});
```

[Sign in with a cookie](../../plugins/youtube/#sign-in-with-a-cookie) explains the cookie, and the ytdl-core
[PO token guide](https://distube.js.org/ytdl-core/guides/po-tokens/) covers PO token providers.

## Cancellation

`play`, `queue.add`, `resolve`, `search`, `suggest` and `voices.join` accept `signal`. An already-aborted signal
rejects `ABORTED` before any work starts. Aborting before the item is inserted prevents the insertion. After that,
aborting cannot undo it. An `Error` abort reason becomes the `cause`. Deleting the queue or disposing the client
cancels pending work with `INVALID_STATE`.

A `signal` passed to a plugin's `stream` or `prepare` aborts when the item is skipped, jumped over or its queue is
deleted. See [plugin authoring](../../extending/plugin-authoring/).

## Cleanup failures

`dispose()` and `leave()` attempt every cleanup even if one fails. Failures reject with one `AggregateError` inside a
`DisTubeError`. The code is `VOICE_FAILED` when a voice or queue cleanup failed, otherwise `SOURCE_FAILED`. A failed
cleanup never revives a deleted queue or changes how an item ended.
