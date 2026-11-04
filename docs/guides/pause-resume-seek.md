---
title: Pause, resume and seek
description: Slash commands that pause, resume and move within the current track.
sidebar:
  order: 6
---

On this page you add `/pause`, `/resume` and `/seek`. All three act on the track that is playing, and all three
wait for the voice player to confirm the change.

## The command files

```ts title="commands/pause.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("pause")
  .setDescription("Pause playback")
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
  await queue.pause();
  await interaction.editReply("Paused playback.");
}
```

```ts title="commands/resume.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("resume")
  .setDescription("Resume playback")
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
  await queue.resume();
  await interaction.editReply("Resumed playback.");
}
```

```ts title="commands/seek.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("seek")
  .setDescription("Seek within the current track")
  .setContexts(InteractionContextType.Guild)
  .addNumberOption(option =>
    option.setName("seconds").setDescription("Position in seconds").setRequired(true).setMinValue(0),
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
  const seconds = interaction.options.getNumber("seconds", true);
  await interaction.deferReply();
  await queue.seek(seconds);
  await interaction.editReply(`Seeked to ${seconds} seconds.`);
}
```

Add the three to `commands/index.ts`: import each one, for example `import * as pause from "./pause.ts";`, and put
`pause, resume, seek` in the `commands` array.

## Why these commands defer

`pause`, `resume` and `seek` settle only once the voice player confirms the change. Discord gives you three seconds
for the first reply, so each command defers before it waits on the player.

## When they fail

All three need a track that has started. While none has, for example before the first one or while the next one
loads, they reject with `INVALID_STATE`.
`seek` can also reject in these cases:

- `INVALID_ARGUMENT` for a negative position, or one past the track's known duration.
- `UNSUPPORTED` when the track's playback resource cannot seek, such as a plain byte stream.
- `INVALID_STATE` when the track ends before the seek lands.
- `VOICE_FAILED` when the player fails to seek.

You do not need to catch any of these. The router from [Command handling](../command-handling/) replies with
`errorMessage`. If the player rejects a change, the call rejects and DisTube publishes nothing.

## Position and updates

`queue.position` gives the seconds played of the current track. A progress bar or a `/nowplaying` reply can read it
at any time.

While the status is `playing`, `queue.position` advances `queue.playbackRate` seconds per second. Nightcore at 1.25
moves 1.25 seconds each second. The [live status](../now-playing/#live-status-updates) section on the now-playing
page shows how to keep a clock from that.

Each pause, resume or seek the player confirms publishes one `queue.updated` with the new `state.status` and
`position`. A progress message stays current without polling. Pausing a paused queue changes nothing and publishes
nothing, and so does resuming a playing one.

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's
[pause.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/pause.ts),
[resume.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/resume.ts) and
[seek.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/seek.ts).

## Next

[Repeat and autoplay](../repeat-and-autoplay/) decides what plays when the waiting list runs out.
