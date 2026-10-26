---
title: Repeat and autoplay
description: Slash commands that set the repeat mode and turn related-track autoplay on or off.
sidebar:
  order: 6
---

`/repeat` picks `off`, `song` or `queue`. `/autoplay` keeps music going with related tracks when the waiting list runs out.

```ts
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube, RepeatMode } from "distube";

declare const distube: DisTube;

const modes = ["off", "song", "queue"] as const satisfies readonly RepeatMode[];

export const repeat = new SlashCommandBuilder()
  .setName("repeat")
  .setDescription("Set what repeats when a track finishes")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option =>
    option
      .setName("mode")
      .setDescription("Repeat mode")
      .setRequired(true)
      .addChoices(...modes.map(mode => ({ name: mode, value: mode }))),
  )
  .toJSON();

export const autoplay = new SlashCommandBuilder()
  .setName("autoplay")
  .setDescription("Continue with related tracks when the queue runs out")
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption(option => option.setName("enabled").setDescription("Turn autoplay on or off").setRequired(true))
  .toJSON();

export async function executeRepeat(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const mode = interaction.options.getString("mode", true) as RepeatMode;
  queue.setRepeat(mode);
  await interaction.reply(`Repeat mode set to ${mode}.`);
}

export async function executeAutoplay(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const enabled = interaction.options.getBoolean("enabled", true);
  queue.setAutoplay(enabled);
  await interaction.reply(enabled ? "Autoplay enabled." : "Autoplay disabled.");
}
```

`setRepeat` and `setAutoplay` are synchronous, so the handlers need no `deferReply`. Both settings go away with the queue, so the next `/play` starts with repeat `off` and autoplay off.

`song` replays the current track and `queue` cycles the whole list. `skip` moves on even in `song` mode.

Autoplay items have `item.autoplay === true` and the metadata of the track they followed (see [Announce what is playing](../now-playing/)). Autoplay asks the plugin that owns the last item's Song for a related Song. A Spotify Song has no `related`, so autoplay asks the plugin whose Song played it, the `fallback` on `queue.item.started`, and queues that plugin's related Song. A failure emits `queue.autoplay.failed`, and nobody ran a command to receive an error reply, so log it:

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

distube.on("queue.autoplay.failed", ({ song, error }) => console.error("autoplay failed", song.name, error));
```

See also: [queue reference](../../reference/queue/), [events reference](../../reference/events/) and the example's [repeat.ts](https://github.com/distubejs/example/blob/v6/src/commands/repeat.ts) and [autoplay.ts](https://github.com/distubejs/example/blob/v6/src/commands/autoplay.ts).
