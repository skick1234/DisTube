---
title: Leave, deafen, mute and move
description: Control the bot's voice connection from slash commands, with or without a queue.
sidebar:
  order: 9
---

Commands that leave the channel, toggle self-deafen and self-mute, move the bot to another channel, and join a
channel without starting playback.

```ts
import type { ChatInputCommandInteraction } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;

export async function leave(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!distube.voices.has(interaction.guildId)) {
    await interaction.reply("I am not connected to a voice channel.");
    return;
  }
  await interaction.deferReply();
  await distube.voices.leave(interaction.guildId);
  await interaction.editReply("Left the voice channel.");
}

export async function deafen(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const voice = distube.voices.get(interaction.guildId);
  if (!voice) {
    await interaction.reply("I am not connected to a voice channel.");
    return;
  }
  const enabled = interaction.options.getBoolean("enabled") ?? !voice.selfDeaf;
  await interaction.deferReply();
  await voice.setSelfDeaf(enabled);
  await interaction.editReply(enabled ? "Self-deafened." : "Undeafened.");
}

export async function mute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const voice = distube.voices.get(interaction.guildId);
  if (!voice) {
    await interaction.reply("I am not connected to a voice channel.");
    return;
  }
  const enabled = interaction.options.getBoolean("enabled") ?? !voice.selfMute;
  await interaction.deferReply();
  await voice.setSelfMute(enabled);
  await interaction.editReply(enabled ? "Self-muted." : "Unmuted.");
}

export async function move(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  const voice = distube.voices.get(interaction.guildId);
  if (!channel || !voice) {
    await interaction.reply("Join a voice channel while I am connected.");
    return;
  }
  await interaction.deferReply();
  await voice.move(channel);
  await interaction.editReply(`Moved to ${channel.name}.`);
}

export async function join(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  await interaction.deferReply();
  await distube.voices.join(channel, { selfDeaf: false });
  await interaction.editReply(`Joined ${channel.name}.`);
}
```

`distube.voices` holds one voice per guild, and none of these commands needs a queue. `voices.leave` also deletes
the guild's queue, so a second `/leave` finds nothing and the command replies that the bot is not connected.
`voice.move` keeps the queue and the settings and continues playback in the new channel. `voices.join` connects
without playing, and the bot stays until something leaves. Self-deafen is
on by default when the bot joins. Pass `selfDeaf: false` to join undeafened.

## See also

- [Voice and filters reference](../../reference/voice-and-filters/) for every voice setting.
- [Leave voice](../leave-when-empty/) after the queue ends or the channel empties.
- Example bot: [leave.ts](https://github.com/distubejs/example/blob/v6/src/commands/leave.ts), [deafen.ts](https://github.com/distubejs/example/blob/v6/src/commands/deafen.ts), [mute.ts](https://github.com/distubejs/example/blob/v6/src/commands/mute.ts).
