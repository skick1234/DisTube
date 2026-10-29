---
title: Pause, resume and seek
description: Slash commands that pause, resume and move within the current track.
sidebar:
  order: 7
---

`/pause`, `/resume` and `/seek` act on the track that is playing.

```ts
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;

const guild = InteractionContextType.Guild;

export const pause = new SlashCommandBuilder()
  .setName("pause")
  .setDescription("Pause playback")
  .setContexts(guild)
  .toJSON();
export const resume = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume playback")
  .setContexts(guild)
  .toJSON();
export const seek = new SlashCommandBuilder()
  .setName("seek")
  .setDescription("Seek within the current track")
  .setContexts(guild)
  .addNumberOption(option =>
    option.setName("seconds").setDescription("Position in seconds").setRequired(true).setMinValue(0),
  )
  .toJSON();

export async function executePause(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  await queue.pause();
  await interaction.editReply("Paused playback.");
}

export async function executeResume(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  await interaction.deferReply();
  await queue.resume();
  await interaction.editReply("Resumed playback.");
}

export async function executeSeek(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const seconds = interaction.options.getNumber("seconds", true);
  await interaction.deferReply();
  await queue.seek(seconds);
  await interaction.editReply(`Seeked to ${seconds} seconds.`);
}
```

These calls finish once the voice player confirms the change, so the handlers defer the reply first.

`seek` can reject, so let your router turn the error into a reply, as in [Play from a slash command](../play-command/). The [queue reference](../../reference/queue/) lists when. `queue.position` gives the elapsed seconds, which a `/seek` reply or a progress bar can use.

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's [pause.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/pause.ts), [resume.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/resume.ts) and [seek.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/seek.ts).
