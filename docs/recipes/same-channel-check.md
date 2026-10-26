---
title: Require the member to be in the bot's channel
description: Reject control commands from members who are not in the same voice channel as the bot.
sidebar:
  order: 10
---

A guard that stops members outside the bot's voice channel from skipping, stopping or changing the music.

```ts
import type { ChatInputCommandInteraction } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;

export async function inBotChannel(interaction: ChatInputCommandInteraction<"cached">): Promise<boolean> {
  const botChannelId = distube.voices.get(interaction.guildId)?.channelId;
  if (!botChannelId) {
    await interaction.reply("I am not connected to a voice channel.");
    return false;
  }
  if (interaction.member.voice.channelId !== botChannelId) {
    await interaction.reply("Join my voice channel first.");
    return false;
  }
  return true;
}

export async function skip(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!(await inBotChannel(interaction))) return;
  await interaction.deferReply();
  await distube.getQueue(interaction.guildId)?.skip();
  await interaction.editReply("Skipped.");
}
```

`voice.channelId` is the channel Discord last confirmed, so it is correct right after a `move`. Call the guard
first in every command that changes playback or voice settings, and return when it replies.

`/play` needs the guard too whenever the bot is connected. A `play` from another channel of the same guild moves
the bot and its queue to the caller's channel, even in the middle of a song. Run the guard when
`distube.voices.has(interaction.guildId)` is true, and skip it only when the bot is not connected, because then
`/play` is how a member starts the bot.

## See also

- [Queue controls](../queue-controls/) for the commands this guard protects.
- [Voice settings](../voice-settings/).
