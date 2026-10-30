---
title: Errors
description: DisTubeError codes, how to narrow them, cancellation and cleanup failures.
sidebar:
  order: 5
---

Every public failure in DisTube is a `DisTubeError`. You tell errors apart by their `code`, never by their message.
Every plugin uses the same codes, so one check works for every provider.

| Field    | What it holds                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| `code`   | A string from the exported `ErrorCode` object, such as `"NOT_FOUND"`                                          |
| `cause`  | The original error from the provider, the platform or a plugin, when there is one                             |
| `source` | The name of the plugin the failure came from, such as `"youtube"`                                             |
| `query`  | The text that found nothing. See [Fields that replace message parsing](#fields-that-replace-message-parsing). |
| `media`  | `"song"` or `"playlist"`, what a failed provider lookup was for                                               |

## Codes

| Code                 | Meaning                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_ARGUMENT`   | The input or the configuration is malformed                                                                                 |
| `INVALID_STATE`      | The call is valid but not allowed now: a deleted queue, a released voice, stale work or a disposed client                   |
| `ABORTED`            | The caller cancelled before the work committed                                                                              |
| `NO_RESULT`          | Every plugin DisTube asked declined                                                                                         |
| `NOT_FOUND`          | The provider says the media does not exist                                                                                  |
| `UNAVAILABLE`        | The media exists but cannot be played, for example a private or region-locked video                                         |
| `RATE_LIMITED`       | The provider throttled the request                                                                                          |
| `BOT_CHECK`          | The provider wants proof that the client is not a bot, such as a sign-in confirmation or a captcha                          |
| `NOT_STARTED`        | Scheduled media that has not started, such as a premiere or a scheduled live                                                |
| `SOURCE_FAILED`      | A plugin failed in any other way, or returned something malformed                                                           |
| `VOICE_FAILED`       | The voice connection, the player or native cleanup failed                                                                   |
| `VOICE_DISCONNECTED` | A voice connection dropped and the adapter could not recover it. Arrives on `voice.disconnected` with reason `platform`.    |
| `UNSUPPORTED`        | The engine or plugin cannot do this: an unknown filter preset, a seek on a `stream` resource, search on a plugin without it |
| `AGE_RESTRICTED`     | The call did not allow age-restricted media, or the provider refused it without an age-verified account                     |

Use `INVALID_ARGUMENT` to ask the member to fix their input. Use `INVALID_STATE` to explain why a valid command cannot
run right now.

No code promises that a retry will work. Here is what to tell members for the codes that come from providers:

| Code             | Usually from                             | Does retrying help?                                         | Tell the member                                     |
| ---------------- | ---------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| `RATE_LIMITED`   | any provider                             | Usually, after a wait                                       | "Try again in a minute."                            |
| `BOT_CHECK`      | YouTube from a datacenter or VPS address | No. The bot's owner needs a signed-in cookie or a PO token. | "The music source is blocked." Then tell the owner. |
| `NOT_STARTED`    | a YouTube premiere or scheduled live     | Yes, once the media starts                                  | "That video has not started yet."                   |
| `UNAVAILABLE`    | any provider                             | No                                                          | "That cannot be played."                            |
| `AGE_RESTRICTED` | a Song marked age-restricted             | Only with `allowAgeRestricted: true`                        | "That is age-restricted."                           |

## Narrowing

`DisTubeError.is(error, code)` checks an unknown error and narrows it to a `DisTubeError` with that code. Without a
code, it accepts any `DisTubeError`.

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

`is` compares the error's name and code, not its class. An error from another installed copy of `distube` narrows
too.

:::caution
Log `cause` to find out what went wrong, but do not show it to members. It can contain request details.
:::

### Fields that replace message parsing

- `query` is the text that found nothing. DisTube sets it only after every plugin declined. It is the query you
  passed, a URL no plugin resolved, or the name-and-artist search DisTube ran for a Spotify track. A plugin's own
  `NO_RESULT` for an empty playlist has no `query`, and its `media` is `"playlist"`.
- `media` is the kind of media a failed provider lookup was for. The official plugins set it from the provider's
  answer. A Spotify album or artist counts as `"playlist"`. Search, autoplay, malformed responses and refused
  credentials (HTTP 401) have none.

## Errors during playback

A track that fails after `play` resolved does not reject `play`. Its error arrives on `queue.item.failed`, described
in [events](../events/).

A player failure there is `VOICE_FAILED`, with the player's error as `cause`. The exception is a player that threw a
`DisTubeError` with another code, such as `UNSUPPORTED`, which arrives as it is. `INVALID_ARGUMENT`, `INVALID_STATE`
and `ABORTED` never arrive on that event.

## Plugin errors

Core wraps every call into a plugin.

- A `DisTubeError` the plugin throws reaches you unchanged, such as `NOT_FOUND`, `UNAVAILABLE` or `RATE_LIMITED`.
- The exceptions are `INVALID_ARGUMENT`, `INVALID_STATE` and `ABORTED`. Those codes describe your input, your queue
  and your cancellation, not the plugin's, so a plugin that throws one gets `SOURCE_FAILED`. The original becomes the
  `cause`, and `source` is the plugin's name.
- Core wraps any other throw the same way.
- When your own `signal` aborted the call, the error is `ABORTED` instead.

DisTube does not scrub messages. Plugins keep signed URLs, tokens and headers out of the errors they build.

## When every plugin failed

When core has asked every plugin and none produced a result, it raises one error for the whole attempt. That happens
for a query search, and for the search that finds something to play for a Spotify track.

- `NO_RESULT` when no plugin failed and every one declined.
- Otherwise the code every failure shares, such as `RATE_LIMITED` when each plugin was throttled. When the failures
  differ, `SOURCE_FAILED`.
- `source` is the plugin name every failure shares. One service that refused reads `source: "soundcloud"`, and
  several services leave it unset.
- `cause` is an `AggregateError` of every failure in the order DisTube tried them, and `query` is the text that found
  nothing.

```ts
import { DisTubeError, ErrorCode } from "distube";
import type { DisTubeQueue } from "distube";

declare const queue: DisTubeQueue;
declare const reply: (message: string) => Promise<void>;

try {
  await queue.add("a song query");
} catch (error) {
  if (DisTubeError.is(error, ErrorCode.RATE_LIMITED))
    await reply(error.source ? `${error.source} is throttling me.` : "Every music source is throttling me.");
  else throw error;
}
```

## Bot check

YouTube sometimes answers "Sign in to confirm you're not a bot". It happens most on datacenter and VPS addresses.
`@distube/youtube` raises it as `BOT_CHECK`, with `error.source` set to `"youtube"`. The `cause` is a `YtdlError` whose
`code` is also `BOT_CHECK`.

```ts
import { DisTubeError, ErrorCode } from "distube";
import type { DisTube } from "distube";

declare const distube: DisTube;

distube.on("queue.item.failed", ({ error }) => {
  if (DisTubeError.is(error, ErrorCode.BOT_CHECK)) console.error("YouTube wants a signed-in cookie or a PO token.");
});
```

[Sign in with a cookie](../../plugins/youtube/#sign-in-with-a-cookie) explains the cookie, and the ytdl-core
[PO token guide](https://distube.js.org/ytdl-core/guides/po-tokens/) covers PO token providers.

## Premieres

A premiere or scheduled live that has not started rejects `NOT_STARTED`. The code carries no start time. The original
`YtdlError` in `cause` keeps it as `startTime`, a `Date`. Do not show `cause` itself to members. Tell them to try
again later.

## Cancellation

`play`, `queue.add`, `distube.resolve`, `distube.search`, `distube.suggest` and `distube.voices.join` take a `signal`.

- A signal that is already aborted rejects `ABORTED` before any work starts.
- Aborting before the item is inserted prevents the insertion. After that, aborting cannot undo it.
- An `Error` abort reason becomes the `cause`.
- Deleting the queue or disposing the client cancels pending work with `INVALID_STATE`.

The `signal` that core passes to a plugin's `stream` or `prepare` aborts when the item is skipped, jumped over, or its
queue is deleted. See [plugin authoring](../../extending/plugin-authoring/).

## Cleanup failures

`dispose()` and `leave()` attempt every cleanup step, even when one fails. The failures reject together as one
`AggregateError` inside a `DisTubeError`. The code is `VOICE_FAILED` when a voice or queue cleanup failed, and
`SOURCE_FAILED` otherwise. A failed cleanup never brings back a deleted queue or changes how an item ended.
