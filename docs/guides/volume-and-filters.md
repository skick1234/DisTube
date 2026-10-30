---
title: Volume and filters
description: Add /volume to set how loud the bot plays, and /filter to switch audio presets with autocomplete.
sidebar:
  order: 8
---

In this guide you add `/volume`, which sets how loud the bot plays, and `/filter`, which switches audio presets such
as bass boost or nightcore. While a member types a filter name, `/filter` suggests the presets your bot supports.

Both settings live on the voice connection, not on the queue. That has two effects:

- The commands work with or without a queue, as long as the bot is in a voice channel.
- The settings survive the end of a queue. The bot forgets them when it leaves the channel.

## The volume command

Create `commands/volume.ts`:

```ts title="commands/volume.ts"
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("volume")
  .setDescription("Set the playback volume")
  .setContexts(InteractionContextType.Guild)
  .addIntegerOption(option =>
    option.setName("percent").setDescription("Volume percentage").setRequired(true).setMinValue(0).setMaxValue(100),
  )
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
  const percent = interaction.options.getInteger("percent", true);
  await interaction.deferReply();
  await voice.setVolume(percent);
  await interaction.editReply(`Volume set to ${percent}%.`);
}
```

`distube.voices.get` returns the guild's voice, or `undefined` when the bot is not connected. `setVolume` resolves
once the player has applied the new volume, which is why the command defers its reply first.

`setVolume` accepts 0 to 1000, but the built-in engine clips above 100. Louder settings only distort, so the command
caps the option at 100 and Discord enforces it for you.

To register the command, add `import * as volume from "./volume.ts";` to `commands/index.ts` and put `volume` in the
`commands` list.

## The filter command

`distube.filters` lists every preset your engine can render. It is a map from preset name to a description with
these fields:

- `label` is the preset's display name, such as `Bass boost`. It never contains a value.
- `acceptsValue` tells you whether the preset takes a number, like the strength of bass boost.
- `default`, `min` and `max` describe that number.

You can read `distube.filters` as soon as the client exists, before the bot joins any channel. Every voice accepts
exactly these names, so it is the right source for autocomplete.

Create `commands/filter.ts`:

```ts title="commands/filter.ts"
import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import type { DisTube, FilterSelection } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("filter")
  .setDescription("Toggle a filter preset, or set a ranged preset to a value")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option =>
    option.setName("name").setDescription("Filter preset").setRequired(true).setAutocomplete(true),
  )
  .addNumberOption(option => option.setName("value").setDescription("Value for a ranged preset"))
  .toJSON();

export async function autocomplete(
  interaction: AutocompleteInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const partial = interaction.options.getFocused().toLowerCase();
  const choices = [...distube.filters]
    .filter(([name]) => name.includes(partial))
    .slice(0, 25)
    .map(([name, info]) => ({
      name: info.acceptsValue
        ? `${info.label} (${info.min ?? "..."} to ${info.max ?? "..."}, default ${info.default ?? "none"})`
        : info.label,
      value: name,
    }));
  await interaction.respond(choices);
}

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const voice = distube.voices.get(interaction.guildId);
  if (!voice) {
    await interaction.reply("I am not connected to a voice channel.");
    return;
  }
  const name = interaction.options.getString("name", true);
  const value = interaction.options.getNumber("value");
  await interaction.deferReply();
  if (value !== null) {
    await voice.filters.set(name, value);
    const entry = voice.filters.entries.find(candidate => candidate.name === name);
    await interaction.editReply(`Applied ${entry ? describe(entry) : name}.`);
    return;
  }
  await voice.filters.toggle(name);
  const active = voice.filters.entries.map(describe);
  await interaction.editReply(`Active filters: ${active.length > 0 ? active.join(", ") : "none"}.`);
}

function describe(entry: FilterSelection): string {
  return entry.value === undefined ? entry.label : `${entry.label} (${entry.value})`;
}
```

The command has two paths:

- With a `value`, `filters.set` turns the preset on at that value. If it is already on, the new value replaces the
  old one in place and the other presets keep their order. A value outside `min` and `max` is clamped to the range.
- Without a `value`, `filters.toggle` turns the preset on at its default, or off if it is already on.

`voice.filters.entries` lists the active presets in the order they were selected, as `{ name, value, label }`.
Because a `label` never includes the value, `describe` adds it.

A name the engine does not know rejects with `UNSUPPORTED`. A value for a preset that takes none rejects with
`INVALID_ARGUMENT`. In both cases the active filters stay as they were, and the router from
[Command handling](../command-handling/) replies with the error message.

Because the `name` option sets `setAutocomplete(true)`, Discord sends an autocomplete interaction while the member
types. The router passes it to `autocomplete`. Discord shows at most 25 choices, so the list stops there.

To register the command, add `import * as filter from "./filter.ts";` to `commands/index.ts` and put `filter` in the
`commands` list.

## Filters that change the speed

Presets such as `nightcore` and `vaporwave` change the speed as well as the pitch. `queue.playbackRate` tells you how
many seconds of the track play per real second. It is `1.25` for nightcore at its default, and `1` with no filter or
no voice.

Every filter change that takes effect publishes a `queue.updated` event carrying the new `playbackRate`. A progress
bar needs it to keep its clock right. [Now playing](../now-playing/) shows how to use it.

If the engine cannot work out the speed of the new selection, the change rejects with `INVALID_ARGUMENT` and the
active filters stay as they were.

The [voice and filters reference](../../reference/voice-and-filters/) lists every preset and its range. The example
bot has the same [volume.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/volume.ts) and
[filter.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/filter.ts).

## Next

[Search and autocomplete](../search-and-autocomplete/) adds `/search`, which lets members pick a result.
