---
title: Play short sound clips
description: Add a /sound command that plays a clip you host, even while music is playing.
sidebar:
  order: 2
---

This page adds a `/sound` command that plays a short clip right away, even in the middle of a song. You pick the
clips. Members choose one by name.

A clip is an ordinary Song that a tiny plugin plays. You build the Song yourself, because a string passed to
`distube.play` is a search query, not a file path. The plugin only needs `stream`. Core hands every Song back to the
plugin its `source` names, and `stream` returns a fresh resource each time the clip plays.

## Write the clips plugin

Put the clip list, the plugin and a helper that builds a clip's Song in one file:

```ts title="clips.ts"
import { Song } from "distube";
import type { Plugin } from "distube/integrations";

export const clipUrls = {
  example: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg",
  toreador: "https://upload.wikimedia.org/wikipedia/commons/4/40/Toreador_song_cleaned.ogg",
} as const;

export type ClipName = keyof typeof clipUrls;

export const clips: Plugin = {
  name: "clips",
  async stream(song) {
    return { kind: "url", url: song.url };
  },
};

export function clipSong(name: ClipName): Song {
  return new Song({ source: clips.name, id: name, name, url: clipUrls[name] });
}
```

A Song needs `source`, `id`, `name` and `url`. `source` must match the plugin's `name`, which is how core finds the
plugin that plays it.

:::caution
A Song is public state. Its fields appear in events, in `queue.current` and in whatever your bot shows. Keep
private paths and credentials out of them.
:::

To play files from disk instead, have `stream` return `{ kind: "file", path }` with an absolute path.

## Add the plugin to the client

Put `clips` in `plugins` next to your music source:

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";
import { clips } from "./clips.ts";

declare const client: Client;

export const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin(), clips],
});
```

Its place in the array does not matter. `clips` has no `resolve` or `search`, so it never answers a URL or a query.

## Write the command

```ts title="commands/sound.ts"
import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";
import { type ClipName, clipSong, clipUrls } from "../clips.ts";

export const data = new SlashCommandBuilder()
  .setName("sound")
  .setDescription("Play a short clip now")
  .addStringOption(option =>
    option
      .setName("name")
      .setDescription("Clip to play")
      .setRequired(true)
      .addChoices(...Object.keys(clipUrls).map(name => ({ name, value: name }))),
  )
  .toJSON();

export async function execute(interaction: ChatInputCommandInteraction<"cached">, distube: DisTube): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const name = interaction.options.getString("name", true) as ClipName;
  await interaction.deferReply();
  const { queue, items } = await distube.play(channel, clipSong(name), { next: true });
  if (queue.current && queue.current !== items[0]) await queue.skip();
  await interaction.editReply(`Playing ${name}.`);
}
```

The choices come from `clipUrls`, so Discord only lets a member send a name that has a URL. That makes the
`as ClipName` cast safe.

`next: true` puts the clip at the front of the waiting list. On its own, that plays the clip when the current track
ends. The `skip` line makes it play now:

- When another item is current, `queue.skip()` ends it and the clip starts.
- When the queue was idle, the clip is the item that starts next, so the command skips nothing. A skip there would drop
  the clip.

:::tip
To add this file to the [guides](../../guides/command-handling/) bot, type `distube` as `DisTube<CommandMetadata>` and
pass `metadata` in the options object, as `commands/play.ts` does. Then add `sound` to the command list.
:::

## What happens to the music

The skipped track goes to history and does not resume after the clip, even with repeat on. To hear it again, add it
to the queue again. The clip is a normal queue item, so it fires the same events as music and shows up
in `/queue`.

On a queue you already hold, `queue.add(clipSong(name), { next: true })` adds the clip without joining. `await
queue.stop()` stops the clip and everything queued after it.

## See also

- [Playback resources](../../extending/playback-resources/) for every resource kind a plugin can return.
- [Skip, jump, shuffle and edit the queue](../../guides/queue-controls/) for `skip`.
- The example bot's [sound.ts](https://github.com/distubejs/example/blob/v6/discordjs/commands/sound.ts) and
  [clips.ts](https://github.com/distubejs/example/blob/v6/discordjs/clips.ts). Its `/sound` only queues the clip next
  and does not skip.
