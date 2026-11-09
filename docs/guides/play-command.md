---
title: Play from a slash command
description: Join the member's voice channel, queue what they asked for and reply with what was added.
sidebar:
  order: 2
---

On this page you write `/play`. It takes a URL or search text, joins the member's voice channel and queues the
result. It is the only command that creates a queue, so every other guide builds on it.

## The command file

Create `commands/play.ts`:

```ts title="commands/play.ts"
import {
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { type DisTube, DisTubeError, ErrorCode } from "distube";
import type { CommandMetadata } from "./index.ts";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a URL or search query")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option => option.setName("input").setDescription("URL or search query").setRequired(true))
  .addBooleanOption(option => option.setName("next").setDescription("Insert at the front of the waiting list"))
  .toJSON();

function isNsfwChannel(channel: GuildTextBasedChannel | null): boolean {
  if (!channel) return false;
  if (channel.isThread()) return channel.parent?.nsfw ?? false;
  return channel.nsfw;
}

export async function execute(
  interaction: ChatInputCommandInteraction<"cached">,
  distube: DisTube<CommandMetadata>,
): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const input = interaction.options.getString("input", true).trim();
  if (!input) {
    await interaction.reply("Provide a URL or search query.");
    return;
  }
  const allowAgeRestricted = isNsfwChannel(interaction.channel);
  await interaction.deferReply();
  try {
    const { items } = await distube.play(channel, input, {
      metadata: { requestedBy: interaction.user.id, channelId: interaction.channelId },
      next: interaction.options.getBoolean("next") ?? false,
      allowAgeRestricted,
    });
    const playlist = items[0]?.playlist;
    await interaction.editReply(
      playlist
        ? `Added ${items.length} items from ${playlist.name}.`
        : `Added ${items[0]?.song.name ?? "your request"}.`,
    );
  } catch (error) {
    if (!DisTubeError.is(error, ErrorCode.AGE_RESTRICTED)) throw error;
    await interaction.editReply(
      allowAgeRestricted
        ? "The provider refused that age-restricted item."
        : "Age-restricted items play only in age-restricted channels.",
    );
  }
}
```

Then add it to `commands/index.ts`: put `import * as play from "./play.ts";` with the imports and `play` in the
`commands` array. Restart the bot and `/play` shows up in Discord.

## Defer before you play

Discord gives you three seconds for the first reply. Resolving a URL or running a search can take longer, so the
command calls `deferReply()` first and answers with `editReply()` later. The two early replies come before the
defer, because they need no lookup.

## What play gives back

`distube.play` resolves `{ queue, items }`. `items` holds the queue items this call added, in order:

- A single Song gives one item.
- A Playlist gives one item per Song, and each item's `playlist` names the Playlist it came from. That is how the
  reply can say "Added 12 items from Road trip".

Each call gets back only its own items. When two members run `/play` at the same moment, each reply names what that
member added.

The promise settles once the items are in the queue, not when the first one starts playing. The track may still be
loading, so the reply says "Added" and an event listener announces the start. The next page sets that up.

The `next` option puts the items at the front of the waiting list instead of the end.

## Metadata travels with each item

DisTube stores the `metadata` you pass on every item this call adds and hands it back on every event for those
items. Keeping the text channel's id there is what lets a later event know where to post, long after this
interaction is gone.

## Age-restricted media

By default DisTube keeps age-restricted media out of the queue:

- `play` rejects an age-restricted Song with `AGE_RESTRICTED`.
- `play` drops a Playlist's age-restricted Songs. Songs whose age restriction is unknown stay.
- `distube.search` leaves age-restricted results out.

This command allows them only in age-restricted channels. It reads the channel's `nsfw` flag, or the parent
channel's flag for a thread, and passes it as `allowAgeRestricted`. Pass the option on every call, because DisTube
does not remember it. If your bot has a per-server setting for adult content, combine it with the channel check.
Autoplay does not apply the option.

A provider can refuse an age-gated video even when you allowed it. YouTube does that without an age-verified account,
such as when no cookie is set. That also rejects `AGE_RESTRICTED`, which is why the reply checks what the command
passed before it words the message.

Every other error goes to the router from [Command handling](../command-handling/), which replies with
`errorMessage`. That covers a search with no result (`NO_RESULT`), a link to something that does not exist
(`NOT_FOUND`) and an item the provider will not play (`UNAVAILABLE`).

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's
[play.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/play.ts).

## Next

[Announce what is playing](../now-playing/) posts in chat when tracks are queued, start and fail.
