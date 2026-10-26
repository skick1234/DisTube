---
title: Announce what is playing
description: Post to the requester's text channel when tracks are added, start or fail.
sidebar:
  order: 2
---

Four events cover what a listener wants to see in chat: an item was added, a playlist was added, a track started, a track failed.

```ts
import type { Client } from "discord.js";
import type { DisTube } from "distube";

interface Metadata {
  readonly requestedBy: string;
  readonly channelId: string;
}

declare const client: Client;
declare const distube: DisTube<Metadata>;

async function announce(metadata: Metadata | undefined, content: string): Promise<void> {
  if (!metadata) return;
  const channel = client.channels.cache.get(metadata.channelId);
  if (!channel?.isSendable()) return;
  await channel.send({
    content: `${content} Requested by <@${metadata.requestedBy}>.`,
    allowedMentions: { parse: [] },
  });
}

distube.on("queue.item.added", ({ item }) => announce(item.metadata, `Queued ${item.song.name}.`));
distube.on("queue.playlist.added", ({ items }) => announce(items[0]?.metadata, `Queued ${items.length} tracks.`));
distube.on("queue.item.started", ({ item }) => announce(item.metadata, `Now playing: ${item.song.name}`));
distube.on("queue.item.failed", ({ item }) => announce(item.metadata, `Could not play ${item.song.name}.`));
```

Post from `item.metadata`, not from the interaction that ran `/play`. An interaction token expires, and the song may start long after the command. A playlist produces one `queue.playlist.added` event instead of one `queue.item.added` per track.

Autoplay items reuse the metadata of the item they followed, so they post in the same channel and credit the same requester. Check `item.autoplay` to word them differently.

A failed item is skipped and the queue moves on. DisTube catches errors thrown by your listeners, so a failed `channel.send` does not change playback. Handle it anyway if you want a log line. Use `allowedMentions: { parse: [] }` so a song title cannot ping anyone.

See also: [events reference](../../reference/events/), [errors reference](../../reference/errors/) and the example's [index.ts](https://github.com/distubejs/example/blob/v6/src/index.ts).
