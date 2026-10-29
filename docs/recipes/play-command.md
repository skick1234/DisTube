---
title: Play from a slash command
description: Join the member's voice channel, queue what they asked for and turn DisTube errors into replies.
sidebar:
  order: 1
---

`/play` takes a URL or search text, queues it in the member's voice channel and replies when the items are in the queue.

```ts
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { type DisTube, DisTubeError, ErrorCode } from "distube";

interface Metadata {
  readonly requestedBy: string;
  readonly channelId: string;
}

declare const distube: DisTube<Metadata>;

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a URL or search query")
  .setContexts(InteractionContextType.Guild)
  .addStringOption(option => option.setName("input").setDescription("URL or search query").setRequired(true))
  .addBooleanOption(option => option.setName("next").setDescription("Insert at the front of the waiting list"))
  .toJSON();

export async function execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
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
  await interaction.deferReply();
  try {
    await distube.play(channel, input, {
      metadata: { requestedBy: interaction.user.id, channelId: interaction.channelId },
      next: interaction.options.getBoolean("next") ?? false,
    });
    await interaction.editReply("Added to the queue.");
  } catch (error) {
    if (DisTubeError.is(error, ErrorCode.NO_RESULT)) await interaction.editReply("Nothing found for that query.");
    else if (DisTubeError.is(error, ErrorCode.NOT_FOUND)) await interaction.editReply("That item does not exist.");
    else if (DisTubeError.is(error, ErrorCode.UNAVAILABLE)) await interaction.editReply("That item cannot be played.");
    else throw error;
  }
}
```

Call `deferReply()` before `play`. Resolving a URL or searching can take longer than the three seconds Discord gives for a first reply. The reply says the items were added. The track may not have started yet, so announce the start from the `queue.item.started` event (see [Announce what is playing](../now-playing/)).

`metadata` is stored on every item this call adds and comes back on every event for that item. Keep the text channel id there so later events know where to post.

By default `play` rejects an age-restricted Song with `AGE_RESTRICTED`, drops the age-restricted Songs of a playlist,
and `search` leaves them out. To let a server admin allow adult content, pass `allowAgeRestricted` on every call. Playlist Songs whose provider gives no answer stay, and autoplay does not apply the option.

```ts
declare const settings: { allowNsfw(guildId: string): boolean };
const text = interaction.channel;
const nsfwChannel = (text?.isThread() ? text.parent?.nsfw : text?.nsfw) ?? false;
const allowAgeRestricted = settings.allowNsfw(interaction.guildId) || nsfwChannel;
await distube.play(channel, input, { metadata, allowAgeRestricted });
```

`DisTubeError.is(error, code)` narrows `error` to a `DisTubeError` with that code. Rethrow anything else, and have your interaction router reply with a generic failure. Do not show `error.cause` to users, because a provider error can contain request details.

See also: [queue reference](../../reference/queue/), [errors reference](../../reference/errors/) and the example's [play.ts](https://github.com/distubejs/example/blob/v6/src/commands/play.ts).
