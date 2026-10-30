---
title: Skip, jump, shuffle and edit the queue
description: Slash commands that skip, jump, go back, shuffle, clear, remove, reorder and stop.
sidebar:
  order: 5
---

On this page you add eight commands that change the queue: `/skip`, `/jump`, `/previous`, `/shuffle`, `/clear`,
`/remove`, `/reorder` and `/stop`. Each one is its own file, and each one starts the way `/queue` did. It looks up the
guild's queue, replies if there is none, then calls one queue method.

When you have written them, add all eight to `commands/index.ts`. Import each file the same way as before, for
example `import * as skip from "./skip.ts";`, and put `skip, jump, previous, shuffle, clear, remove, reorder, stop` in the
`commands` array.

## Positions count the waiting list

Members type positions, so the commands take one-based positions in `queue.upcoming`, the waiting list. Position 1
is the track after the one playing. A position past the end of the list fails with `INVALID_STATE`, and the router
from [Command handling](../command-handling/) replies with `errorMessage`.

`queue.jump` and `queue.remove` also accept an item's `id`. An id keeps pointing at the same item while tracks play,
so use ids when you build buttons instead of slash command options. `queue.move` takes ids only.

## Skip and stop

```ts title="commands/skip.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current track")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  const next = await queue.skip();
  await interaction.editReply(next ? `Skipped. Up next: ${next.song.name}.` : "Skipped. Nothing is waiting.");
}
```

`skip` ends the current track and resolves the item that plays next, read when the skip committed. It resolves
`undefined` when nothing waits. It does not wait for the next item to start. It names that item even when the
skipped one was still loading.

When autoplay is on and nothing waits, `skip` resolves `undefined` while autoplay looks for a related track. With
nothing playing and nothing waiting, it rejects with `INVALID_STATE`.

```ts title="commands/stop.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop playback and delete the queue")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  await queue.stop();
  await interaction.editReply("Stopped playback and deleted the queue.");
}
```

`stop` deletes the queue. The bot stays in the voice channel and keeps its volume and filters for the next
`/play`. To leave the channel as well, see [Voice settings](../voice-settings/).

## Jump and previous

```ts title="commands/jump.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("jump")
  .setDescription("Jump to a waiting track")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption(option =>
    option
      .setName("position")
      .setDescription("One-based position in the waiting list")
      .setRequired(true)
      .setMinValue(1),
  )
  .addBooleanOption(option =>
    option.setName("requeue").setDescription("Re-append the skipped tracks instead of sending them to history"),
  )
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const position = interaction.options.getInteger("position", true);
  await interaction.deferReply();
  await queue.jump(position, { requeue: interaction.options.getBoolean("requeue") ?? false });
  await interaction.editReply(`Jumped to waiting position ${position}.`);
}
```

`jump` ends the current track and plays the one at `position`. The current track and the tracks before the target
go to history. With `requeue`, they go to the end of the waiting list instead.

```ts title="commands/previous.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("previous")
  .setDescription("Replay the last track")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  await queue.previous();
  await interaction.editReply("Replaying the previous track.");
}
```

`previous` replays the most recent track in history, and the current track waits right behind it at the front of the
waiting list. With an empty history it rejects with `INVALID_STATE`. The command does not check for that itself. The
router replies for it.

## Shuffle and clear

```ts title="commands/shuffle.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("shuffle")
  .setDescription("Shuffle the waiting list")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  queue.shuffle();
  await interaction.reply(`Shuffled ${queue.upcoming.length} waiting tracks.`);
}
```

```ts title="commands/clear.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("clear")
  .setDescription("Remove every waiting track")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const removed = queue.clear();
  await interaction.reply(`Cleared ${removed.length} waiting tracks.`);
}
```

The queue methods `shuffle`, `clear`, `remove` and `move` change the waiting list before they return and never touch
the track that is playing. They return no promise, so these commands reply without deferring. They throw instead of
rejecting when something is wrong, and the router catches that the same way.

## Remove and reorder

```ts title="commands/remove.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("remove")
  .setDescription("Remove one waiting track or a range")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption(option =>
    option.setName("from").setDescription("Position of the track to remove").setRequired(true).setMinValue(1),
  )
  .addIntegerOption(option => option.setName("to").setDescription("Last position of an inclusive range").setMinValue(1))
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const from = interaction.options.getInteger("from", true);
  const to = interaction.options.getInteger("to");
  const removed = queue.remove(to === null ? from : { from, to });
  await interaction.reply(`Removed ${removed.length} tracks.`);
}
```

`remove` takes one position, or a `{ from, to }` range that includes both ends, and returns the items it removed.

```ts title="commands/reorder.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("reorder")
  .setDescription("Move a waiting track to another position")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption(option =>
    option.setName("position").setDescription("Position of the track to move").setRequired(true).setMinValue(1),
  )
  .addIntegerOption(option =>
    option.setName("before").setDescription("Put it before this position; leave empty for the end").setMinValue(1),
  )
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const item = queue.upcoming[interaction.options.getInteger("position", true) - 1];
  const before = interaction.options.getInteger("before");
  const target = before === null ? undefined : queue.upcoming[before - 1];
  if (!item || (before !== null && !target)) {
    await interaction.reply("No track at that position.");
    return;
  }
  queue.move(item.id, target?.id);
  await interaction.reply("Moved the track.");
}
```

`queue.move(itemId, beforeItemId)` puts the item before another one, or at the end when you leave the second id out.
Because it takes ids, the command looks both positions up in `queue.upcoming` first.

## Updates after each change

Every change here that commits publishes one `queue.updated`, which a [live status](../now-playing/#live-status-updates)
message can redraw from. A `jump` over several tracks publishes one update. A command that changes nothing, such as
moving a track to the place it already has, publishes none.

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's
[skip.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/skip.ts),
[jump.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/jump.ts),
[previous.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/previous.ts),
[shuffle.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/shuffle.ts),
[clear.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/clear.ts),
[remove.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/remove.ts) and
[stop.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/stop.ts).

## Next

[Pause, resume and seek](../pause-resume-seek/) controls the track that is playing.
