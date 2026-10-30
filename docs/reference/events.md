---
title: Events
description: Every event, what it carries and the order events fire in.
sidebar:
  order: 4
---

DisTube tells your bot what happens through typed events. Subscribe with `distube.on(name, listener)`. It returns a
function that removes the listener, so keep it if you ever need to unsubscribe.

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

const unsubscribe = distube.on("queue.item.started", event => {
  console.log(event.guildId, event.item.song.name, event.timestamp);
});
unsubscribe();
```

## The events

| Event                   | Fires when                              | Extra fields                                     |
| ----------------------- | --------------------------------------- | ------------------------------------------------ |
| `queue.created`         | A guild gets a new, empty queue         | none                                             |
| `queue.item.added`      | A Song was added                        | `item`                                           |
| `queue.playlist.added`  | A Playlist was added                    | `playlist`, `items`                              |
| `queue.item.started`    | An item became audible                  | `item`, optional `fallback`                      |
| `queue.item.finished`   | An item played to its end               | `item`                                           |
| `queue.item.failed`     | An item could not be prepared or played | `item`, `error`                                  |
| `queue.finished`        | Playback ran out of items               | none                                             |
| `queue.autoplay.failed` | Autoplay could not add a related Song   | `song`, `error`                                  |
| `queue.updated`         | Anything a status view shows changed    | `position`, `playbackRate`                       |
| `queue.deleted`         | The queue is gone                       | `reason`                                         |
| `voice.disconnected`    | The bot's voice in a guild ended        | `voice`, `channelId`, `reason`, optional `error` |

Every queue event also carries `guildId`, the `queue`, a snapshot `state` and the `timestamp` of the change. `state`
holds `current`, `upcoming`, `history`, `status`, `repeat` and `autoplay` as they were at that moment. `state.status`
is `idle`, `preparing`, `playing` or `paused`, as the [queue reference](../queue/#status) explains. Voice events carry
`guildId`, `voice` and `timestamp`.

`on` throws `INVALID_ARGUMENT` for a name that is not in this table. A misspelled or v5 name fails when you register
it, instead of never firing.

### Fallback

`fallback` is the Song that actually plays when the item's own plugin cannot stream. For a Spotify track, it is the
YouTube video DisTube found for it, and `item.song` stays the Spotify Song.

If nothing can play the item, it fails with `NO_RESULT`. When the searches or streams failed instead, it fails with the
code they all share, or `SOURCE_FAILED` when they differ. See
[when every plugin failed](../errors/#when-every-plugin-failed).

## queue.updated

`queue.updated` is the one event a live status view needs. DisTube publishes it once for each change to a live queue:
its state, its pause, its position after a seek, or the volume or filters of its voice. On top of the queue fields, it
carries `position` and `playbackRate` as they were at the change.

While `state.status` is `playing`, work out the position now from the event:

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

distube.on("queue.updated", ({ state, position, playbackRate, timestamp }) => {
  const now = state.status === "playing" ? position + ((Date.now() - timestamp) / 1000) * playbackRate : position;
  console.log(`At ${now.toFixed(1)} seconds`);
});
```

With any other status the position stands still. [Announce what is playing](../../guides/now-playing/#live-status-updates)
has a full listener that edits a message.

:::tip
One change between items can publish several updates. Editing a Discord message on every one can hit rate limits, so
throttle it, for example to one edit per second per guild.
:::

When a change also has an event of its own, `queue.updated` comes right after it, with the same `state` and
`timestamp`:

| Change                                               | Events, in order                                              |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `play`, `add`                                        | `queue.item.added` or `queue.playlist.added`, `queue.updated` |
| Autoplay adds a Song                                 | `queue.item.added`, `queue.updated`                           |
| The player takes an item                             | `queue.updated`                                               |
| An item becomes audible                              | `queue.item.started`, `queue.updated`                         |
| An item finishes on its own, with repeat and history | `queue.item.finished`, `queue.updated`                        |
| An item fails to prepare, or the player rejects it   | `queue.item.failed`, `queue.updated`                          |
| An autoplay lookup fails                             | `queue.autoplay.failed`, `queue.updated`                      |
| `skip`, `jump`, `previous`                           | `queue.updated`, once per command                             |
| `remove`, `move`, `shuffle`, `clear`                 | `queue.updated`                                               |
| `setRepeat`, `setAutoplay`                           | `queue.updated`                                               |
| `pause`, `resume`, once the player confirms          | `queue.updated`                                               |
| `seek`, once the player confirms                     | `queue.updated`                                               |
| `voice.setVolume`, `voice.filters.*`, once confirmed | `queue.updated`                                               |

- A command that changes several things publishes one update. A `jump` over three items puts all three in the
  `state.history` of one event.
- A call that changes nothing publishes nothing. That covers `setRepeat` to the current mode, `clear` on an empty
  list, `move` to the place the item already has, `pause` on a paused queue, `setVolume` to the current volume, and a
  filter selection that stayed the same.
- A rejected call publishes nothing, and neither does a pause, resume, seek, volume or filter change the player
  rejects.
- A deleted queue publishes nothing more. Deleting a queue publishes `queue.deleted` and no update.
- A voice with no queue publishes no `queue.updated`.
- Volume and filters are not in the payload, because they belong to the voice. Read `event.queue.voice?.volume` in
  the listener, and you get the latest value.
- `queue.item.finished` carries the state after the finish, so its `state.history` already ends with the finished
  item.
- Starting an item publishes two updates, one when the player takes it and one when it becomes audible. Moving from
  one item to the next publishes three: the finish, the hand-off and the audible start.

## Reasons

`queue.deleted` carries one of these reasons:

| Reason       | Cause                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `stop`       | `queue.stop()`                                                                                                   |
| `finished`   | The queue ran out of items. `queue.finished` came first.                                                         |
| `voice-loss` | The voice session was lost                                                                                       |
| `leave`      | `voice.leave()`, `voices.leave(guildId)`, or `stop()` during the first join                                      |
| `shutdown`   | `distube.dispose()`                                                                                              |
| `failed`     | The first insertion failed and left the queue empty, with no other insertion pending. No `queue.finished` fires. |

`voice.disconnected` carries one of these:

| Reason     | Cause                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `left`     | `voice.leave()` or `voices.leave(guildId)`                                                                                             |
| `removed`  | Discord removed the bot from voice, for example a member disconnected it. No `error`.                                                  |
| `platform` | The connection dropped and the adapter could not recover it. `error` is `VOICE_DISCONNECTED`, with the adapter's error as its `cause`. |
| `shutdown` | `distube.dispose()`                                                                                                                    |

`voice.disconnected` fires once per voice, after that guild's `queue.deleted`.

## Order

- `getQueue(guildId)` finds a new queue before `queue.created` arrives. The event does not promise that the media
  resolves or that the insertion succeeds.
- Adding a Song fires one `queue.item.added`. Adding a Playlist fires one `queue.playlist.added` and no event per item.
  `play` resolves after that. The item can still fail to prepare or play later, which fires `queue.item.failed` for
  it.
- Each item gets at most one of `queue.item.finished` and `queue.item.failed`. An item that a command ends early gets
  neither, only the command's update. The [queue reference](../queue/#items-and-history) has the history rules.
- When the queue runs out, `queue.finished` fires, then `queue.deleted` with reason `finished`.
- When the voice session ends during a track, `queue.deleted` with reason `voice-loss` fires first, then
  `voice.disconnected` with reason `removed` or `platform`. The playing item gets no `queue.item.failed`, because the
  voice failed, not the item.

## Delivery

DisTube delivers each event in a later microtask, in the order the events happened. A listener added during delivery
does not receive that event. A listener that throws or rejects affects nothing else. DisTube reports it to
`onDiagnostic` with stage `event.listener`.

## From v5

| v5 event      | v6                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------- |
| `initQueue`   | `queue.created`                                                                               |
| `addSong`     | `queue.item.added`                                                                            |
| `addList`     | `queue.playlist.added`                                                                        |
| `playSong`    | `queue.item.started`                                                                          |
| `finishSong`  | `queue.item.finished`. A skipped item publishes none.                                         |
| `finish`      | `queue.finished`                                                                              |
| `deleteQueue` | `queue.deleted`                                                                               |
| `disconnect`  | `voice.disconnected`                                                                          |
| `error`       | `queue.item.failed`, and the rejection of `play` or `add`                                     |
| `noRelated`   | `queue.autoplay.failed`                                                                       |
| `empty`       | none. See [leave when empty](../../guides/leave-when-empty/#leave-when-the-channel-is-empty). |
| `ffmpegDebug` | none. The built-in engine runs no ffmpeg process.                                             |
| `debug`       | the `onDiagnostic` option                                                                     |
