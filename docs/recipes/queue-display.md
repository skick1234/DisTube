---
title: Show the queue
description: Reply with the current track, the first ten waiting tracks, repeat, autoplay, volume and filters.
sidebar:
  order: 3
---

`/queue` lists what plays now, what is next and the guild's playback settings.

```ts
import { type ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";

declare const distube: DisTube;

export const data = new SlashCommandBuilder()
  .setName("queue")
  .setDescription("Show the current queue")
  .setContexts(InteractionContextType.Guild)
  .toJSON();

const title = (name: string): string => name.replace(/\s+/gu, " ").trim().slice(0, 120) || "Untitled";

export async function execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("There is no active queue.");
    return;
  }
  const lines = [`Status: ${queue.status}`];
  if (queue.current)
    lines.push(`Now playing: ${title(queue.current.song.name)} [${queue.current.song.formattedDuration}]`);
  if (queue.upcoming.length > 0) {
    lines.push(
      "Up next:",
      ...queue.upcoming.slice(0, 10).map((item, index) => `${index + 1}. ${title(item.song.name)}`),
    );
    if (queue.upcoming.length > 10) lines.push(`and ${queue.upcoming.length - 10} more.`);
  }
  lines.push(`Repeat: ${queue.repeat}, autoplay: ${queue.autoplay ? "on" : "off"}`);
  const voice = queue.voice;
  if (voice) {
    const filters = voice.filters.entries.map(entry => entry.label);
    lines.push(`Volume: ${voice.volume}%, filters: ${filters.length > 0 ? filters.join(", ") : "none"}`);
  }
  await interaction.reply(lines.join("\n"));
}
```

Song names come from providers, so collapse whitespace and cut them to a length Discord accepts. A message holds 2000 characters, which is why the list stops at ten waiting tracks. `formattedDuration` is ready-made text such as `3:45`. Use `song.duration` for the number of seconds.

Volume and filters belong to the voice, not the queue, so they are read from `queue.voice`. It can be `undefined` while the first `/play` is still joining, so check it (see the [queue reference](../../reference/queue/)).

See also: [queue reference](../../reference/queue/), [voice and filters reference](../../reference/voice-and-filters/) and the example's [queue.ts](https://github.com/distubejs/example/blob/v6/src/commands/queue.ts).
