---
title: Show the queue
description: Reply with the current track, the first ten waiting tracks, repeat, autoplay, volume and filters.
sidebar:
  order: 4
---

On this page you write `/queue`. It replies with what plays now, what comes next and the guild's playback
settings. It only reads the queue, so it is a good first look at what a queue holds.

## The command file

Create `commands/queue.ts`:

```ts title="commands/queue.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show the current queue")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

const title = (name: string): string => name.replace(/\s+/gu, " ").trim().slice(0, 120) || "Untitled";

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const lines = [`Status: ${queue.status}`];
  if (queue.current) {
    const { song, playlist } = queue.current;
    lines.push(`Now playing: ${title(song.name)} [${song.formattedDuration}]`);
    if (playlist) lines.push(`From playlist: ${title(playlist.name)}`);
  }
  if (queue.upcoming.length > 0) {
    lines.push(
      "Up next:",
      ...queue.upcoming.slice(0, 10).map((item, index) => `${index + 1}. ${title(item.song.name)}`),
    );
    if (queue.upcoming.length > 10) lines.push(`and ${queue.upcoming.length - 10} more.`);
  }
  lines.push(`Repeat: ${queue.repeat}, autoplay: ${queue.autoplay ? "on" : "off"}`);
  const voice = queue.voice;
  if (voice) {
    const filters = voice.filters.entries.map(entry =>
      entry.value === undefined ? entry.label : `${entry.label} ${entry.value}`,
    );
    lines.push(`Volume: ${voice.volume}%, filters: ${filters.length > 0 ? filters.join(", ") : "none"}`);
  }
  await interaction.reply(lines.join("\n"));
}
```

Add it to `commands/index.ts` with `import * as queue from "./queue.ts";` and `queue` in the `commands` array.

## No queue, no reply to build

`distube.getQueue(guildId)` returns `undefined` when the guild has no queue. That happens before the first `/play`
and again after the queue is deleted, for example by `/stop` or when the last track ends. Every command from here on
starts with this check.

The command does not defer its reply. Everything it reads is already in memory, so it answers well within Discord's
three seconds.

## Reading the queue

- `queue.status` is `idle`, `preparing`, `playing` or `paused`. It says `preparing` while an item waits, an autoplay
  lookup runs or the current track is not audible yet. A `/queue` right after `/play` says "preparing" instead of
  "idle".
- `queue.current` is the item handed to the player, or `undefined`. That item is playing, paused or about to be
  audible. While the next track still loads, it is first in `queue.upcoming` and the status is `preparing`.
- `queue.upcoming` is the waiting list, in play order.
- DisTube sets `item.playlist` only on items that came from a Playlist. A single Song or an autoplay item prints no
  playlist line.
- `song.formattedDuration` is ready-made text such as `3:45`, or `Live` when the duration is unknown. Use
  `song.duration` when you need the number of seconds.

## Keep the reply short and safe

Song names come from providers. `title` collapses their whitespace and cuts them to 120 characters. A Discord
message holds at most 2000 characters, which is also why the list stops at ten waiting tracks.

## Volume and filters live on the voice

Volume and filters belong to the guild's voice, not to its queue, so the command reads them from `queue.voice`. It
is `undefined` while the first `/play` is still joining the channel, so check it before you use it.

A filter's `label` is its display name, such as `Nightcore`, and never contains its value. Print `entry.value` next
to it when there is one. [Volume and filters](../volume-and-filters/) shows how members change them.

See also: [queue reference](../../reference/queue/), [voice and filters reference](../../reference/voice-and-filters/)
and the example's [queue.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/queue.ts).

## Next

[Skip, jump, shuffle and edit the queue](../queue-controls/) adds the commands that change the waiting list.
