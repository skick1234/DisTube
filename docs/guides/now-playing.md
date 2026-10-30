---
title: Announce what is playing
description: Post to the requester's text channel when tracks are queued, start or fail, and keep a live status.
sidebar:
  order: 3
---

`/play` replies once, when the items are in the queue. Everything after that happens later: the track starts, the
next one starts, one fails. On this page you post those moments in the channel where the member asked for the
music.

## The announcements file

Create `announcements.ts` next to `index.ts`:

```ts title="announcements.ts"
import type { Client } from "discord.js";
import type { DisTube } from "distube";
import { type CommandMetadata, errorMessage } from "./commands/index.ts";

export function announce(client: Client, distube: DisTube<CommandMetadata>): void {
  const send = async (metadata: CommandMetadata | undefined, content: string): Promise<void> => {
    if (!metadata) return;
    const channel = client.channels.cache.get(metadata.channelId);
    if (!channel?.isSendable()) return;
    await channel.send({
      content: `${content} Requested by <@${metadata.requestedBy}>.`,
      allowedMentions: { parse: [] },
    });
  };

  distube.on("queue.item.added", ({ item }) => send(item.metadata, `Queued ${item.song.name}.`));
  distube.on("queue.playlist.added", ({ playlist, items }) =>
    send(items[0]?.metadata, `Queued ${items.length} tracks from ${playlist.name}.`),
  );
  distube.on("queue.item.started", ({ item }) =>
    send(item.metadata, `Now playing: ${item.song.name}${item.playlist ? ` from ${item.playlist.name}` : ""}.`),
  );
  distube.on("queue.item.failed", ({ item, error }) =>
    send(item.metadata, `Could not play ${item.song.name}: ${errorMessage(error)}`),
  );
}
```

In `index.ts`, delete the `queue.item.started` listener from [Command handling](../command-handling/). Add
`import { announce } from "./announcements.ts";` to the imports and call `announce(client, distube);` right after you
create `distube`.

## Post from the item, not the interaction

Each message goes to `item.metadata.channelId`, which `/play` stored on the item. Do not keep the interaction
around to reply to later. An interaction token expires, and a song may start long after the command ran.

`allowedMentions: { parse: [] }` stops the message from pinging anyone. Song titles come from providers, and with
this option a title that contains `@everyone` pings no one.

## What each event means

- `queue.item.added` fires when a single Song joins the queue, including a track autoplay picked.
- `queue.playlist.added` fires once for a whole Playlist, instead of one `queue.item.added` per track. It carries the
  `playlist` and all of its `items`.
- `queue.item.started` fires when the track is audible.
- `queue.item.failed` fires when a track cannot be prepared or played. The queue skips it and moves on.

`item.playlist` names the Playlist an item came from, so the "Now playing" message can mention it without a map you
keep for the life of the queue. Items added as a single Song and autoplay items have none. Repeat and `previous`
replays keep it.

Autoplay items reuse the metadata of the item they followed. They post in the same channel and credit the same
requester. Check `item.autoplay` if you want to word them differently.

:::note
DisTube catches errors thrown by your listeners and reports them to `onDiagnostic`, so a failed `channel.send` never
changes playback. Catch it yourself if you want your own log line.
:::

## Live status updates

A message that shows the current track, its clock and the state needs a redraw after every command. You do not
need a refresh call in each command. `queue.updated` fires once per committed change to the queue, its pause, its
position by seek, or the volume or filters of its voice.

This file turns each update into one line of text and hands it to a function you supply, such as one that edits a
status message:

```ts title="status.ts"
import type { DisTube, DisTubeEventMap } from "distube";
import type { CommandMetadata } from "./commands/index.ts";

type QueueUpdate = DisTubeEventMap<CommandMetadata>["queue.updated"];

function positionNow(event: QueueUpdate): number {
  if (event.state.status !== "playing") return event.position;
  return event.position + ((Date.now() - event.timestamp) / 1000) * event.playbackRate;
}

export function watchStatus(distube: DisTube<CommandMetadata>, render: (guildId: string, text: string) => void): void {
  distube.on("queue.updated", event => {
    const { current, status } = event.state;
    if (status === "preparing") return render(event.guildId, "Loading...");
    if (!current) return render(event.guildId, "Nothing is playing.");
    render(event.guildId, `${current.song.name} at ${Math.floor(positionNow(event))}s, ${status}`);
  });
}
```

The event carries `position` and `playbackRate` as they were when the change committed. While `status` is
`playing`, the position now is `position + (Date.now() - timestamp) / 1000 * playbackRate`. The rate matters because
filters such as nightcore play the source faster than the wall clock. While the status is `preparing`, `paused` or
`idle`, the position stands still.

Redraw the clock with your own timer between updates, and use the event only to resync it.

A few details help when you draw from this event:

- `queue.updated` comes after the event of the same change, with the same `state` and `timestamp`.
- Moving from one item to the next publishes three updates: the finish, the hand-off to the player and the moment
  the track is audible.
- A call that changes nothing, such as `pause()` on a paused queue, publishes nothing.

:::tip
Editing a Discord message is rate limited. Throttle your redraw, for example to one edit per second per guild.
:::

The [events reference](../../reference/events/#queueupdated) lists every change that publishes an update.

See also: [events reference](../../reference/events/), [errors reference](../../reference/errors/) and the example's
[bot.ts](https://github.com/distubejs/example/blob/v6/discordjs/bot.ts).

## Next

[Show the queue](../queue-display/) writes `/queue`, which lists what plays now and what comes next.
