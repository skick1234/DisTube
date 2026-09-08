# DisTube guide

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client, VoiceChannel } from "discord.js";
import { DisTube } from "distube";

declare const client: Client;
declare const voiceChannel: VoiceChannel;

const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  sources: [new YouTubePlugin()],
});
const pending = distube.play(voiceChannel, "https://youtu.be/example");
const registered = distube.getQueue(voiceChannel.guildId);
const { queue } = await pending;
console.log(queue === registered);
```

## Registration and insertion

After shallow validation, `play` synchronously registers and reserves one queue for the guild. Lookup and readonly
queue iteration see it immediately, even while source resolution is pending. Its initial state is idle with no
current or upcoming items. The call keeps that exact queue and cannot insert into a replacement after stop.

Calls for one guild run in invocation order. Another guild can progress independently. `queue.created` describes
registration; `play` settles successfully only after insertion. If failed initial work leaves no playback or pending
reservation, its queue is deleted without `queue.finished`. It cannot delete another reservation's queue or release
voice another caller adopted.

`play`, `queue.enqueue` and `distube.resolve` accept a query string, a URL string, a `Song` or a `Playlist`.
Absolute HTTP(S) URLs use configured sources' resolution in order, never query fallback. Other non-empty strings
use source search. The first source returning candidates wins; a failed search can yield to a later source.
Standalone `resolve` creates no queue or voice. `enqueue` requires its existing queue's connected voice and cannot
create a queue, join or move voice.

## Queue controls

`DisTubeGuild.state` captures readonly `current`, `upcoming` and `status`, whose values are `idle`, `playing` or
`paused`. Earlier snapshots retain their committed values. `position` is elapsed seconds, zero without a current
item. `pause`, `resume`, `seek` and `skip` control current playback; state commits only after the relevant backend
acknowledges the effect.

`remove(itemId)` and `move(itemId, beforeItemId?)` address waiting occurrences. Omitting the destination moves to the
tail. Moving before itself does nothing. Current, stale and non-waiting IDs reject `INVALID_STATE`; an empty ID
rejects `INVALID_ARGUMENT`. `skip` ends the current item and tries its successor without applying song repeat.

`stop` deletes the queue and fences pending work immediately, then joins cleanup. Repeated stop joins the same
outcome. Other controls on a deleted queue reject `INVALID_STATE`. A later `play` registers a fresh queue while
backend effects wait for the old cleanup to settle.

## Voice settings

Get `DisTubeVoice` through `distube.voices.get(guildId)` or independently with `await distube.voices.join(channel)`.
Read its live `channelId` and readonly `settings`. Use `voice.move(channel)` for a same-guild move.

- `setVolume(percent)` accepts finite 0–100, default 100.
- `setRepeat(mode)` accepts `"off"`, `"song"` or `"queue"`, default `"off"`.
- `setAutoplay(enabled)` accepts a boolean, default false.
- `setFilters(names)` replaces the complete ordered filter selection, removing duplicate names in first-occurrence
  order. Defaults are empty; `setFilters([])` clears it.

Volume, repeat and autoplay survive queue deletion. Successful queue-deletion cleanup clears selected filters and
backend rendering. Reset failure preserves last acknowledged filters and reports the cleanup failure. It cannot
resurrect the queue or affect replacement playback. `voices.leave(guildId)` releases voice and resets all settings;
a later connection starts with defaults.

## Metadata, events and teardown

`new DisTube<Metadata>({ adapter, sources })` types occurrence metadata. Core borrows the optional caller reference
without cloning, reading or freezing its contents. The occurrence property binding is readonly. Keep other guild
application state in application-owned storage.

Subscribe using `distube.on("queue.item.started", listener)` and retain the returned unsubscribe function. Queue
exhaustion publishes `queue.finished` then `queue.deleted`; pending insertion reservations prevent premature
exhaustion. Caller cancellation before commit rejects `ABORTED`; stop or disposal supersession rejects
`INVALID_STATE`. Call `await distube.dispose()` during application teardown.
