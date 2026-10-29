---
title: Play direct audio links and attachments
description: Add a plugin that plays HTTPS audio file URLs and Discord attachments.
sidebar:
  order: 12
---

A plugin that lets `/play` accept a link to an audio file, or a file the member uploads with the command.

```ts
import type { ChatInputCommandInteraction } from "discord.js";
import { DisTube, Song } from "distube";
import type { Adapter, Plugin } from "distube/integrations";

declare const adapter: Adapter;
declare const youtube: Plugin;

const signedInputs = new Map<string, string>(); // grows until restart, evict by age if that matters
const audioExtension = /\.(?:mp3|ogg|opus|wav|flac|m4a|aac|webm)$/iu;

function fileName(url: URL): string {
  const last = url.pathname.split("/").at(-1) ?? "";
  try {
    return decodeURIComponent(last) || url.hostname;
  } catch {
    return last || url.hostname;
  }
}

export const directLinks: Plugin = {
  name: "direct-links",
  async resolve(input) {
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return undefined;
    }
    const isAttachment = url.hostname === "cdn.discordapp.com" && /^\/(?:ephemeral-)?attachments\//u.test(url.pathname);
    if (url.protocol !== "https:" || !(isAttachment || audioExtension.test(url.pathname))) return undefined;
    const id = url.origin + url.pathname;
    signedInputs.set(id, input);
    return new Song({ source: "direct-links", id, name: fileName(url), url: id });
  },
  async stream(song) {
    return { kind: "url", url: signedInputs.get(song.id) ?? song.url };
  },
};

const distube = new DisTube({ adapter, plugins: [youtube, directLinks] });

export async function play(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  const attachment = interaction.options.getAttachment("file");
  const input = attachment?.url ?? interaction.options.getString("query");
  if (!input) {
    await interaction.reply("Give a link or attach a file.");
    return;
  }
  await interaction.deferReply();
  await distube.play(channel, input);
  await interaction.editReply("Queued.");
}
```

`resolve` returns `undefined` for anything it does not own, and core moves on to the next plugin. Put
`directLinks` after the provider plugins in `plugins`. An ordinary page URL then still goes to the provider that
owns it, and only a link no provider claims reaches this plugin. The check that matters is the extension or the
Discord CDN path, so a plain `https://example.com/page` is declined. Discord serves a file uploaded through a
slash command option from `/ephemeral-attachments/`, and the check accepts both paths.

`stream` returns a `url` resource and the built-in engine fetches it. `queue.seek` works when the link's server
serves byte ranges and rejects with `UNSUPPORTED` otherwise. An attachment URL is a signed link that expires, so
a queued attachment may fail to start if it waits a long time. The signed link stays in the plugin's
`signedInputs` map, and `Song.url` holds the address without its query. Core keeps signed playback URLs out of
songs, events and queue state, so keep them out of those fields too. The file's name becomes the track title, and
there is no duration.

The slash command declares an attachment option `file` and a string option `query`, both optional in Discord.
The command replies when the member gives neither.

## See also

- [Playback resources](../../extending/playback-resources/) for `file` and `reader` resources that can seek.
- [Plugin authoring](../../extending/plugin-authoring/) for the full plugin contract.
- [Play a song](../play-command/).
