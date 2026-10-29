---
title: Search with autocomplete and a select menu
description: Suggest queries while the member types, then let them pick one search result to queue.
sidebar:
  order: 4
---

`/search` completes the query from provider suggestions, lists up to ten results in a select menu and queues the one the member picks.

```ts
import {
  ActionRowBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  ComponentType,
  InteractionContextType,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import type { DisTube } from "distube";

interface Metadata {
  readonly requestedBy: string;
  readonly channelId: string;
}

declare const distube: DisTube<Metadata>;

const title = (name: string): string => name.replace(/\s+/gu, " ").trim().slice(0, 100) || "Untitled";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search and pick a track to play")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option =>
    option.setName("query").setDescription("What to search for").setRequired(true).setAutocomplete(true),
  )
  .toJSON();

export async function autocomplete(interaction: AutocompleteInteraction<"cached">): Promise<void> {
  const partial = interaction.options.getFocused().trim();
  const suggestions = partial ? await distube.suggest(partial, { signal: AbortSignal.timeout(2500) }) : [];
  await interaction.respond(
    suggestions.slice(0, 25).map(text => ({ name: text.slice(0, 100), value: text.slice(0, 100) })),
  );
}

export async function execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  if (!interaction.member.voice.channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const query = interaction.options.getString("query", true).trim();
  await interaction.deferReply();
  const songs = await distube.search(query, { limit: 10 });
  if (songs.length === 0) {
    await interaction.editReply("No results for that query.");
    return;
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId("search")
    .setPlaceholder("Pick a track")
    .addOptions(
      songs.map((song, index) => ({
        label: title(song.name),
        description: [song.artist, song.formattedDuration].filter(Boolean).join(", ").slice(0, 100),
        value: String(index),
      })),
    );
  const message = await interaction.editReply({
    content: `Results for ${query}`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
  });
  const selection = await message
    .awaitMessageComponent({
      componentType: ComponentType.StringSelect,
      filter: component => component.user.id === interaction.user.id,
      time: 60_000,
    })
    .catch(() => undefined);
  if (!selection) {
    await interaction.editReply({ content: "Search timed out.", components: [] });
    return;
  }
  await selection.deferUpdate();
  const song = songs[Number(selection.values[0])];
  const channel = interaction.member.voice.channel;
  if (!song || !channel) {
    await interaction.editReply({ content: "Join a voice channel first.", components: [] });
    return;
  }
  await distube.play(channel, song, {
    metadata: { requestedBy: interaction.user.id, channelId: interaction.channelId },
  });
  await interaction.editReply({ content: "Added to the queue.", components: [] });
}
```

Route autocomplete interactions to `autocomplete` and chat input interactions to `execute`. Discord wants an autocomplete answer within three seconds, so the example gives `suggest` a 2.5 second `AbortSignal.timeout`. Autocomplete only asks the provider. It does not touch a queue or a voice. Discord accepts at most 25 choices of 100 characters each.

`distube.search` returns `Song` values. Pass the chosen `Song` to `play` as it is, so DisTube does not search a second time. Check the member's voice channel again after the menu closes, because they may have left while choosing.

Only the member who ran `/search` can pick, and the menu gives up after 60 seconds.

## Search options

`distube.search(query, { source?, limit?, offset?, signal? })` returns ranked Songs. The defaults are limit 10 and
offset 0, and an offset past the available results returns an empty list. With `source` set to a configured plugin
instance, it searches only that plugin and types `pluginData` by it. Without it, plugins are asked in order and the
first non-empty result wins.

`distube.suggest(query, { source?, signal? })` returns up to 25 completions from the named plugin or the first one
that answers.

A plugin instance that is not configured on this client rejects `INVALID_ARGUMENT`. Plugin errors propagate.

See also: the example's [search.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/search.ts).
