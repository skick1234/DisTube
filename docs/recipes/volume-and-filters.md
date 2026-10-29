---
title: Set volume and filters
description: Change the playback volume and toggle audio filter presets from slash commands.
sidebar:
  order: 8
---

Two slash commands: `/volume` sets the volume, and `/filter` toggles a preset or sets a ranged one. The filter
command offers the presets your engine supports as autocomplete choices.

```ts
import type { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;

export async function volume(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
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

export async function filterChoices(interaction: AutocompleteInteraction<"cached">): Promise<void> {
  const voice = distube.voices.get(interaction.guildId);
  const partial = interaction.options.getFocused().toLowerCase();
  const choices = voice
    ? [...voice.filters.definitions]
        .filter(([name]) => name.includes(partial))
        .slice(0, 25)
        .map(([name, definition]) => ({
          name: definition.acceptsValue
            ? `${name} (${definition.min ?? "..."} to ${definition.max ?? "..."}, default ${definition.default ?? "none"})`
            : name,
          value: name,
        }))
    : [];
  await interaction.respond(choices);
}

export async function filter(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
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
    await interaction.editReply(`Applied ${name}.`);
    return;
  }
  await voice.filters.toggle(name);
  const labels = voice.filters.entries.map(entry => entry.label);
  await interaction.editReply(`Active filters: ${labels.length > 0 ? labels.join(", ") : "none"}.`);
}
```

Volume and filters belong to the voice, not the queue, so both commands work with or without a queue and survive
the queue ending. They are lost when the bot leaves the channel. The command caps `percent` at 100 because louder
volumes distort; the reference lists the full range. `filters.set` with a value replaces that preset in place and keeps the order of the others.
`filters.toggle` removes a preset that is already on.

Declare the options on the slash command: an integer `percent` with a minimum of 0 and a maximum of 100, a string
`name` with `setAutocomplete(true)`, and an optional number `value`.

## See also

- [Voice and filters reference](../../reference/voice-and-filters/) for the full preset list and ranges.
- [Voice settings](../voice-settings/) for deafen, mute and moving.
- Example bot: [volume.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/volume.ts), [filter.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/filter.ts).
