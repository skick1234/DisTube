---
title: Play direct audio links and attachments
description: Add a plugin that plays HTTPS audio file URLs and files members upload with the command.
sidebar:
  order: 3
---

This page adds a plugin that lets `/play` take a link to an audio file, or a file the member uploads with the command.
v5 had separate direct-link and file plugins. In v6 it is one small plugin you keep in your bot.

:::caution[Use at your own risk]
This recipe makes the bot fetch any HTTPS URL a member types that ends in an audio extension, and the built-in
engine follows redirects to any HTTP or HTTPS host. A member can link a public `.mp3` that redirects to
`http://127.0.0.1:8080/` or another address on the bot's network, and the bot sends that request. Run it only
where members are trusted. Checking `url.hostname` in `resolve` against hosts you allow covers only the link the
member typed, not the redirects the engine follows from it.
:::

## Write the plugin

```ts title="direct-links.ts"
import { Song } from "distube";
import type { Plugin } from "distube/integrations";

const signedInputs = new WeakMap<Song, string>();
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
    const song = new Song({ source: "direct-links", id, name: fileName(url), url: id, ageRestricted: false });
    signedInputs.set(song, input);
    return song;
  },
  async stream(song) {
    return { kind: "url", url: signedInputs.get(song) ?? song.url };
  },
};
```

`resolve` decides which links the plugin takes. It accepts an HTTPS link whose path ends in an audio extension, or a
file on Discord's CDN. Anything else returns `undefined`, and core asks the next plugin. A plain
`https://example.com/page` is declined, because it has neither. Discord serves a file uploaded through a slash command
option from `/ephemeral-attachments/`, so the check accepts both attachment paths.

The file's name becomes the track title. The Song has no duration, because the plugin does not download the file to
find out. `ageRestricted: false` tells core the answer is already known, so a Song passed to `play` again, such as one
from `queue.history`, plays as it is instead of going back through `resolve` with its unsigned `url`.

### Why the signed link stays in a map

An attachment URL is a signed link. Its query string carries a signature, and the link stops working when the
signature expires. The plugin keeps the full link in `signedInputs`, keyed by the Song that `resolve` returned, and
`Song.url` holds the address without its query. That has two effects:

- Two links to the same file with different signatures each play their own link.
- An entry goes away with its Song, because a `WeakMap` does not keep its keys alive.

:::caution
Core keeps signed playback URLs out of songs, events and queue state. Keep them out of those fields in your own
plugins too, or anything that logs or shows a Song leaks the signature.
:::

## Add it to the client

Put `directLinks` after your provider plugins:

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import type { Client } from "discord.js";
import { DisTube } from "distube";
import { directLinks } from "./direct-links.ts";

declare const client: Client;

export const distube = new DisTube({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin(), directLinks],
});
```

Core tries `resolve` in `plugins` order. With `directLinks` last, a YouTube URL still goes to the YouTube plugin, and
only a link no provider claims reaches this one.

## Accept a link or a file in `/play`

Give `/play` an optional attachment option `file` and an optional string option `query`. Discord cannot require one
of two options, so the command checks for itself:

```ts title="commands/play.ts"
import { type ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import type { DisTube } from "distube";

export const data = new SlashCommandBuilder()
  .setName("play")
  .setDescription("Play a link, a file or a search query")
  .addAttachmentOption(option => option.setName("file").setDescription("Audio file to play"))
  .addStringOption(option => option.setName("query").setDescription("URL or search query"))
  .toJSON();

export async function execute(interaction: ChatInputCommandInteraction<"cached">, distube: DisTube): Promise<void> {
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

An attachment's URL is an HTTPS link like any other, so `play` sends it through `resolve` and `directLinks` picks it
up.

In the [guides](../../guides/command-handling/) bot, type `distube` as `DisTube<CommandMetadata>` and keep the
`metadata` and age check from [Play from a slash command](../../guides/play-command/).

## Seeking and expiry

`stream` returns a `url` resource, and the built-in engine fetches it. `queue.seek` works when the link's server
serves byte ranges, and rejects `UNSUPPORTED` when it does not.

A queued attachment may fail to start if it waits a long time, because its signed link can expire first. The failure
arrives on `queue.item.failed` like any other.

## See also

- [Playback resources](../../extending/playback-resources/) for `file` and `reader` resources that can seek.
- [Plugin authoring](../../extending/plugin-authoring/) for the full plugin contract.
- [Play from a slash command](../../guides/play-command/) for the rest of `/play`.
