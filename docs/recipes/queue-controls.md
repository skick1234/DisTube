---
title: Skip, jump, shuffle and edit the queue
description: Slash commands that skip, jump, go back, shuffle, clear, remove, reorder and stop.
sidebar:
  order: 5
---

Every queue edit starts the same way: look up the guild's queue, reply if there is none, then call one method. This file holds the handlers for `/skip`, `/jump`, `/previous`, `/shuffle`, `/clear`, `/remove`, `/move` and `/stop`.

```ts
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube, DisTubeQueue } from "distube";

interface Metadata {
  readonly requestedBy: string;
  readonly channelId: string;
}

declare const distube: DisTube<Metadata>;

const guild = InteractionContextType.Guild;

export const skip = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current track")
  .setContexts(guild)
  .toJSON();
export const jump = new SlashCommandBuilder()
  .setName("jump")
  .setDescription("Jump to a waiting track")
  .setContexts(guild)
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
export const previous = new SlashCommandBuilder()
  .setName("previous")
  .setDescription("Replay the last track")
  .setContexts(guild)
  .toJSON();
export const shuffle = new SlashCommandBuilder()
  .setName("shuffle")
  .setDescription("Shuffle the waiting list")
  .setContexts(guild)
  .toJSON();
export const clear = new SlashCommandBuilder()
  .setName("clear")
  .setDescription("Remove every waiting track")
  .setContexts(guild)
  .toJSON();
export const remove = new SlashCommandBuilder()
  .setName("remove")
  .setDescription("Remove one waiting track or a range")
  .setContexts(guild)
  .addIntegerOption(option =>
    option.setName("from").setDescription("Position of the track to remove").setRequired(true).setMinValue(1),
  )
  .addIntegerOption(option => option.setName("to").setDescription("Last position of an inclusive range").setMinValue(1))
  .toJSON();
export const move = new SlashCommandBuilder()
  .setName("move")
  .setDescription("Move a waiting track")
  .setContexts(guild)
  .addIntegerOption(option =>
    option.setName("position").setDescription("Position of the track to move").setRequired(true).setMinValue(1),
  )
  .addIntegerOption(option =>
    option.setName("before").setDescription("Put it before this position; leave empty for the end").setMinValue(1),
  )
  .toJSON();
export const stop = new SlashCommandBuilder()
  .setName("stop")
  .setDescription("Stop playback and delete the queue")
  .setContexts(guild)
  .toJSON();

async function withQueue(
  interaction: ChatInputCommandInteraction<"cached">,
  run: (queue: DisTubeQueue<Metadata>) => Promise<string> | string,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  await interaction.editReply(await run(queue));
}

export const handlers = {
  skip: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, async queue => {
      await queue.skip();
      return "Skipped the current track.";
    }),
  jump: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, async queue => {
      const position = interaction.options.getInteger("position", true);
      await queue.jump(position, { requeue: interaction.options.getBoolean("requeue") ?? false });
      return `Jumped to waiting position ${position}.`;
    }),
  previous: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, async queue => {
      await queue.previous();
      return "Replaying the previous track.";
    }),
  shuffle: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, queue => {
      queue.shuffle();
      return `Shuffled ${queue.upcoming.length} waiting tracks.`;
    }),
  clear: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, queue => {
      queue.clear();
      return "Cleared the waiting list.";
    }),
  remove: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, queue => {
      const from = interaction.options.getInteger("from", true);
      const to = interaction.options.getInteger("to");
      return `Removed ${queue.remove(to === null ? from : { from, to }).length} tracks.`;
    }),
  move: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, queue => {
      const item = queue.upcoming[interaction.options.getInteger("position", true) - 1];
      const before = interaction.options.getInteger("before");
      const target = before === null ? undefined : queue.upcoming[before - 1];
      if (!item || (before !== null && !target)) return "No track at that position.";
      queue.move(item.id, target?.id);
      return "Moved the track.";
    }),
  stop: (interaction: ChatInputCommandInteraction<"cached">) =>
    withQueue(interaction, async queue => {
      await queue.stop();
      return "Stopped playback and deleted the queue.";
    }),
};
```

Positions are one-based and count the waiting list (`queue.upcoming`), so position 1 is the track after the one playing. `jump` and `remove` also accept an item id, which stays correct for buttons as tracks play. `move` takes ids only, so `/move` looks them up in `queue.upcoming` first.

`jump` and `skip` end the current track. Without `requeue`, `jump` sends the skipped tracks to history. With it, they go to the end of the waiting list. `previous` needs history and rejects with `INVALID_STATE` when there is none, so let your router turn that error into a reply. `shuffle`, `clear`, `remove` and `move` change the waiting list at once and never touch the track that is playing.

`stop` deletes the queue but keeps the voice connected with its volume and filters. To leave the channel as well, see [Voice settings](../voice-settings/).

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's [skip.ts](https://github.com/distubejs/example/blob/v6/src/commands/skip.ts), [jump.ts](https://github.com/distubejs/example/blob/v6/src/commands/jump.ts), [previous.ts](https://github.com/distubejs/example/blob/v6/src/commands/previous.ts), [shuffle.ts](https://github.com/distubejs/example/blob/v6/src/commands/shuffle.ts), [clear.ts](https://github.com/distubejs/example/blob/v6/src/commands/clear.ts), [remove.ts](https://github.com/distubejs/example/blob/v6/src/commands/remove.ts) and [stop.ts](https://github.com/distubejs/example/blob/v6/src/commands/stop.ts).
