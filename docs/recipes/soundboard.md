---
title: Play short sound clips
description: Play an application-owned clip next, cutting the current track short.
sidebar:
  order: 13
---

A `/sound` command that plays a short clip next, and starts it at once when music is playing. The skipped track
goes to history and does not resume after the clip. To hear it again, add it to the queue again.

```ts
import type { ChatInputCommandInteraction } from "discord.js";
import { DisTube, Song } from "distube";
import type { Adapter, Plugin } from "distube/integrations";

declare const adapter: Adapter;
declare const music: Plugin;

const clipUrls = {
  example: "https://upload.wikimedia.org/wikipedia/commons/c/c8/Example.ogg",
  toreador: "https://upload.wikimedia.org/wikipedia/commons/4/40/Toreador_song_cleaned.ogg",
} as const;

type ClipName = keyof typeof clipUrls;

const clips: Plugin = {
  name: "clips",
  async stream(song) {
    return { kind: "url", url: song.url };
  },
};

const distube = new DisTube({ adapter, plugins: [music, clips] });

export async function sound(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const name = interaction.options.getString("name", true) as ClipName;
  await interaction.deferReply();
  const clip = new Song({ source: clips.name, id: name, name, url: clipUrls[name] });
  const wasPlaying = distube.getQueue(channel.guildId)?.current !== undefined;
  const queue = await distube.play(channel, clip, { next: true });
  if (wasPlaying) await queue.skip();
  await interaction.editReply(`Playing ${name}.`);
}
```

A clip is a Song whose plugin only has `stream`. Core hands the Song back to the plugin named by `source`, and the
plugin returns a fresh resource each time. The Song needs `source`, `id`, `name` and `url`. A string passed to
`distube.play` is a search query, not a file path, so build the Song yourself. Keep private paths and credentials
out of Song fields. Declare `name` as a required string option with `addChoices` built from
`Object.keys(clipUrls)`, so a member cannot send a name that has no URL.

`next: true` puts the clip at the front of the upcoming list. With no `skip`, it starts when the current track
ends. When music is playing, `queue.skip()` moves that track to history and starts the clip now. Skip only in
that case. In an idle queue the clip is already the current item, and a skip would drop it. The clip is a normal
queue item, so it fires the same events as music. On a queue you already hold, `queue.add(clip, { next: true })`
does the same without joining. `await queue.stop()` stops the clip and everything queued after it.

For files on disk, return `{ kind: "file", path }` with an absolute path instead of a URL.

## See also

- [Playback resources](../../extending/playback-resources/) for every resource kind.
- [Queue controls](../queue-controls/) for `skip`.
- Example bot: [sound.ts](https://github.com/distubejs/example/blob/v6/src/commands/sound.ts), [clips.ts](https://github.com/distubejs/example/blob/v6/src/clips.ts).
