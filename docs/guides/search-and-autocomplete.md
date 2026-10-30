---
title: Search and autocomplete
description: Add /search, which suggests queries while the member types and lets them pick one result to play.
sidebar:
  order: 9
---

`/play` takes the first result for a query. Sometimes a member wants to choose. In this guide you add `/search`,
which does three things:

1. While the member types, it suggests complete queries from the provider.
2. When they send the command, it lists up to ten results in a select menu.
3. When they pick one, it queues that track.

## The search command

Create `commands/search.ts`:

```ts title="commands/search.ts"
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
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("search")
  .setDescription("Search and pick a track to play")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option =>
    option.setName("query").setDescription("What to search for").setRequired(true).setAutocomplete(true),
  )
  .toJSON();

export async function autocomplete(
  interaction: AutocompleteInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const partial = interaction.options.getFocused().trim();
  const suggestions = partial ? await distube.suggest(partial, { signal: AbortSignal.timeout(2500) }) : [];
  await interaction.respond(
    suggestions.slice(0, 25).map(text => ({ name: text.slice(0, 100), value: text.slice(0, 100) })),
  );
}

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  if (!interaction.member.voice.channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const query = interaction.options.getString("query", true).trim();
  if (!query) {
    await interaction.reply("Provide a search query.");
    return;
  }
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
      songs.slice(0, 10).map((song, index) => ({
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

function title(name: string): string {
  return name.replace(/\s+/gu, " ").trim().slice(0, 100) || "Untitled";
}
```

To register the command, add `import * as search from "./search.ts";` to `commands/index.ts` and put `search` in the
`commands` list. The router in `index.ts` sends autocomplete interactions to `autocomplete` and the command itself
to `execute`.

## Suggestions while the member types

Discord drops an autocomplete answer that takes longer than three seconds. That is why `autocomplete` gives `suggest`
a 2.5 second `AbortSignal.timeout`. When the provider is slow or fails, `suggest` rejects. The router from
[Command handling](../command-handling/) catches that and answers with no suggestions, still inside the three
seconds.

`suggest` only asks the provider. It never touches a queue or a voice, so a suggestion cannot change what is playing.
Discord accepts at most 25 choices of up to 100 characters each, so the code trims both.

## Picking a result

`distube.search` returns `Song` values. Each one becomes an option in the menu, with its index as the value. When
the member picks, the code passes that `Song` to `play` as it is, so DisTube does not search a second time.

The member may leave the voice channel while they choose. That is why `execute` reads
`interaction.member.voice.channel` again after the menu closes.

Only the member who ran `/search` can pick, because of the `filter` on `awaitMessageComponent`. After 60 seconds the
menu gives up and the reply says the search timed out.

:::tip
Discord limits a select menu label to 100 characters. The `title` helper collapses whitespace and cuts long names, so a
messy track name never breaks the menu.
:::

## Search options

`distube.search(query, options)` returns ranked Songs. It takes these options:

- `limit` is how many results to ask for. The default is 10.
- `offset` skips that many results, for paging. The default is 0. An offset past the last result returns an empty
  list.
- `source` is one of your configured plugin instances. DisTube searches only that plugin and types the results'
  `pluginData` by it. Without `source`, DisTube asks the plugins in order and returns the first non-empty result.
- `signal` cancels the search.
- `allowAgeRestricted` keeps results marked age-restricted. By default `search` leaves them out. Results whose age
  restriction is unknown stay in, and `play` checks them later.

`distube.suggest(query, options)` returns up to 25 completions. It takes `source` and `signal` the same way, and
without `source` it uses the first plugin that answers with any suggestions.

Both methods reject with `INVALID_ARGUMENT` when `source` is a plugin instance this client was not built with. A
`source` that cannot search makes `search` reject with `UNSUPPORTED`. When the plugin itself fails, both reject with
`SOURCE_FAILED` and the plugin's error as the `cause`. The one exception is a `DisTubeError` the plugin throws with
any code other than `INVALID_ARGUMENT`, `INVALID_STATE` or `ABORTED`, which reaches you unchanged.

The example bot has the same [search.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/search.ts).

## Next

[Voice settings](../voice-settings/) adds commands that join and leave a voice channel.
