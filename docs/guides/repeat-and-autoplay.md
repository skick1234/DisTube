---
title: Repeat and autoplay
description: Add /repeat to replay a track or the whole queue, and /autoplay to keep music going with related tracks.
sidebar:
  order: 7
---

In this guide you add two commands. `/repeat` chooses what plays again when a track ends. `/autoplay` keeps the
music going with related tracks once the queue runs out.

## The repeat command

A queue has three repeat modes:

- `off` plays each item once. Every new queue starts here.
- `song` plays the current track again when it finishes.
- `queue` puts each finished track back at the end, so the whole list cycles.

Create `commands/repeat.ts`:

```ts title="commands/repeat.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube, RepeatMode } from "distube";
import type { CommandMetadata } from "./index.ts";

const modes = ["off", "song", "queue"] as const satisfies readonly RepeatMode[];

export const data = new SlashCommandBuilder()
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

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const mode = interaction.options.getString("mode", true) as RepeatMode;
  queue.setRepeat(mode);
  await interaction.reply(`Repeat mode set to ${mode}.`);
}
```

The `mode` option only offers the three choices, so the cast to `RepeatMode` is safe. `setRepeat` changes the queue
before it returns. There is nothing to wait for, so the command replies right away without `deferReply`.

Only a track that plays to its end repeats. `/skip` ends the track early, so it moves on even in `song` mode.

Each replay is a new queue item. It gets a new `id` and keeps the `metadata`, `autoplay` and `playlist` of the item
it replays. Your announcements from [Now playing](../now-playing/) still find the right text channel.

To register the command, open `commands/index.ts`, add `import * as repeat from "./repeat.ts";` and put `repeat` in the
`commands` list.

## The autoplay command

Create `commands/autoplay.ts`:

```ts title="commands/autoplay.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("autoplay")
  .setDescription("Continue with related tracks when the queue runs out")
  .setContexts(InteractionContextType.Guild)
  .addBooleanOption(option => option.setName("enabled").setDescription("Turn autoplay on or off").setRequired(true))
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
  const enabled = interaction.options.getBoolean("enabled", true);
  queue.setAutoplay(enabled);
  await interaction.reply(enabled ? "Autoplay enabled." : "Autoplay disabled.");
}
```

Like `setRepeat`, `setAutoplay` returns once the queue has changed, so this command needs no `deferReply` either.
Register it the same way: `import * as autoplay from "./autoplay.ts";` in `commands/index.ts`, and `autoplay` in the
`commands` list.

:::note
Repeat and autoplay belong to the queue. When the queue ends, they go with it, so the next `/play` starts with repeat
`off` and autoplay off.
:::

## How autoplay picks the next track

When the last item ends and nothing waits in `upcoming`, autoplay asks a plugin for a Song related to the track that
just played. DisTube passes the queue's history along, so the plugin can avoid tracks that already played.

The plugin it asks is the one that owns the last Song. A Spotify Song is the exception. The Spotify plugin has no
`related` lookup, and its Songs play through another plugin's search. That other Song is the `fallback` on
`queue.item.started`, and autoplay asks the plugin that owns it.

An autoplay item has `item.autoplay === true`. It copies the metadata of the track it follows, so it is announced in
the same channel.

## Watch the queue while autoplay looks

Each change to repeat or autoplay publishes one `queue.updated` event. Setting the value the queue already has
publishes none.

While autoplay waits for a related Song, `queue.status` reads `preparing` and `upcoming` is empty. If a member runs
`/autoplay enabled:false` during that wait, the status turns `idle` in the same update.

## Log autoplay failures

A failed lookup emits `queue.autoplay.failed`, and the status reads `idle`. The queue then finishes as it would with
autoplay off. Nobody ran a command at that moment, so there is no interaction to reply to. Log the failure instead.
Add this listener to `index.ts`, after you create `distube`:

```ts title="index.ts"
distube.on("queue.autoplay.failed", ({ song, error }) => {
  console.error(`Autoplay found nothing after ${song.name}`, error);
});
```

`song` is the track autoplay tried to follow. If an autoplay item fails to play, `queue.item.failed` reports it.
Autoplay does not look again after that, so the queue ends unless a member adds something.

The [queue reference](../../reference/queue/) lists every queue setting, and the
[events reference](../../reference/events/) lists every event. The example bot has the same
[repeat.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/repeat.ts) and
[autoplay.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/autoplay.ts).

## Next

[Volume and filters](../volume-and-filters/) adds `/volume` and `/filter`.
