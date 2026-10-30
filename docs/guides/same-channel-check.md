---
title: Same channel check
description: Stop members outside the bot's voice channel from skipping, stopping or changing the music.
sidebar:
  order: 11
---

Right now any member of the server can run `/skip`, even from another voice channel or from no channel at all. In
this guide you add a check that only lets members in the bot's voice channel control the music.

## The check

Create `commands/same-channel.ts`:

```ts title="commands/same-channel.ts"
import type { ChatInputCommandInteraction } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export async function inBotChannel(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<boolean> {
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
```

`inBotChannel` replies and returns `false` when the member may not use the command. The calling command then
returns without doing anything. This file is a helper, not a command, so it does not go in the `commands` list.

`voice.channelId` is the channel Discord last confirmed for the bot. It is already correct right after a `/join` moves
the bot.

## Use it in a command

Call the check first in every command that changes playback or voice settings. That covers the commands from
[Skip, jump, shuffle and edit the queue](../queue-controls/), [Pause, resume and seek](../pause-resume-seek/),
[Volume and filters](../volume-and-filters/), and `/leave`, `/deafen` and `/mute` from
[Voice settings](../voice-settings/). Leave it out of `/join`, whose whole point is to bring the bot to a member in
another channel. Here is `commands/skip.ts` with the check:

```ts title="commands/skip.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";
import { inBotChannel } from "./same-channel.ts";

export const data = new SlashCommandBuilder()
  .setName("skip")
  .setDescription("Skip the current track")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  if (!(await inBotChannel(interaction, distube))) return;
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

The check runs before `deferReply`, because it may need to send the first reply itself.

## Protect /play too

`/play` needs the check as well, but only while the bot is connected.

:::caution
When the bot is already playing in one channel, a `play` from another channel of the same server moves the bot and
its queue to the caller's channel. That happens even in the middle of a song, and the members in the first channel
lose their music.
:::

When the bot is not connected, `/play` is how a member starts it, so the check must not block it. In
`commands/play.ts`, add `import { inBotChannel } from "./same-channel.ts";` to the imports. Then add this line to
`execute`, right after the `if (!channel)` block:

```ts
if (distube.voices.has(interaction.guildId) && !(await inBotChannel(interaction, distube))) return;
```

`voices.has` is `true` while the bot is connected, so the check only runs then.

`/search` from [Search and autocomplete](../search-and-autocomplete/) ends in `play` too, so it can move the bot the
same way. By the time the member picks a result, the command has already replied, so `inBotChannel` cannot answer
for it. In `commands/search.ts`, add this right before `distube.play`:

```ts
const botChannelId = distube.voices.get(interaction.guildId)?.channelId;
if (botChannelId && botChannelId !== channel.id) {
  await interaction.editReply({ content: "Join my voice channel first.", components: [] });
  return;
}
```

It runs after the pick, not before the menu, because the member can switch channels while the menu is open.

## Next

[Leave voice](../leave-when-empty/) disconnects the bot when the queue ends or the channel empties.
