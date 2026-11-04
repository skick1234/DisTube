---
title: Voice settings
description: Add commands that join and leave a voice channel and toggle the bot's self-deafen and self-mute.
sidebar:
  order: 10
---

So far the bot joins a channel when someone runs `/play`. In this guide you add four commands that control the voice
connection directly:

- `/join` connects to the member's channel, or brings the bot and whatever it is playing there.
- `/leave` disconnects.
- `/deafen` and `/mute` toggle the bot's self-deafen and self-mute.

`distube.voices` holds one voice per guild, with or without a queue. None of these commands needs a queue.

## Join

Create `commands/join.ts`:

```ts title="commands/join.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("join")
  .setDescription("Join your voice channel without playing anything")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
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

`voices.join` resolves the voice once the bot is connected. The bot then stays in the channel until something makes
it leave, as [Leave voice](../leave-when-empty/) explains.

If the bot is already in another channel of the server, `join` moves it to the member's channel. The queue, the
volume and the filters move with it, and playback continues in the new channel. That makes a separate move command
unnecessary.

The bot deafens itself by default whenever it joins, from `/play` or from `voices.join`. This command passes
`selfDeaf: false` to join undeafened, so a `/join` that moves a deafened bot also undeafens it. Leave the option out
to keep the default.

## Leave

Create `commands/leave.ts`:

```ts title="commands/leave.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("leave")
  .setDescription("Leave the voice channel")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  if (!distube.voices.has(interaction.guildId)) {
    await interaction.reply("I am not connected to a voice channel.");
    return;
  }
  await interaction.deferReply();
  await distube.voices.leave(interaction.guildId);
  await interaction.editReply("Left the voice channel.");
}
```

:::caution
`voices.leave` deletes the guild's queue before it disconnects. Everything waiting in the queue is gone, and the
volume and filters reset.
:::

After a `/leave`, the guild has no voice. A second `/leave` finds nothing and replies that the bot is not connected.

## Deafen and mute

Create `commands/deafen.ts`:

```ts title="commands/deafen.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("deafen")
  .setDescription("Toggle whether the bot deafens itself")
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption(option => option.setName("enabled").setDescription("Explicit state instead of toggling"))
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
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
```

Create `commands/mute.ts`:

```ts title="commands/mute.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("mute")
  .setDescription("Toggle whether the bot mutes itself")
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption(option => option.setName("enabled").setDescription("Explicit state instead of toggling"))
  .toJSON();

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
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
```

Both commands take an optional `enabled` option. Without it, they flip the current state, which they read from
`voice.selfDeaf` and `voice.selfMute`. Like volume and filters, these settings stay with the voice when a queue ends.

## Register the commands

In `commands/index.ts`, add one import per file:

```ts
import * as deafen from "./deafen.ts";
import * as join from "./join.ts";
import * as leave from "./leave.ts";
import * as mute from "./mute.ts";
```

Then put `join`, `leave`, `deafen` and `mute` in the `commands` list.

The [voice and filters reference](../../reference/voice-and-filters/) lists every voice setting. The example bot has
the same [leave.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/leave.ts),
[deafen.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/deafen.ts) and
[mute.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/mute.ts).

## Next

[Same channel check](../same-channel-check/) stops members outside the bot's channel from controlling it.
