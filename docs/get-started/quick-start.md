---
title: Quick start
description: One discord.js file that plays, skips and stops music with slash commands.
sidebar:
  order: 2
---

Save this as `index.ts`, set `TOKEN` and run it. The bot registers `/play`, `/skip` and `/stop` and announces each
track in the channel where it was requested.

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Client, Events, GatewayIntentBits, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { DisTube, DisTubeError } from "distube";

interface Metadata {
  readonly textChannelId: string;
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const distube = new DisTube<Metadata>({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Play a link or search query")
    .addStringOption(option => option.setName("input").setDescription("Link or search query").setRequired(true)),
  new SlashCommandBuilder().setName("skip").setDescription("Skip the current track"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop playback and clear the queue"),
].map(command => command.setContexts(InteractionContextType.Guild).toJSON());

client.once(Events.ClientReady, async ready => {
  await ready.application.commands.set(commands);
  console.log(`Logged in as ${ready.user.tag}`);
});

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  const queue = distube.getQueue(interaction.guildId);
  try {
    if (interaction.commandName === "play") {
      const channel = interaction.member.voice.channel;
      if (!channel) return void (await interaction.reply("Join a voice channel first."));
      await interaction.deferReply();
      await distube.play(channel, interaction.options.getString("input", true), {
        metadata: { textChannelId: interaction.channelId },
      });
      await interaction.editReply("Added to the queue.");
    } else if (interaction.commandName === "skip") {
      await queue?.skip();
      await interaction.reply(queue ? "Skipped." : "Nothing is playing.");
    } else {
      await queue?.stop();
      await interaction.reply(queue ? "Stopped." : "Nothing is playing.");
    }
  } catch (error) {
    const message = DisTubeError.is(error) ? `Could not do that: ${error.message}` : "Something went wrong.";
    if (interaction.deferred) await interaction.editReply(message);
    else await interaction.reply(message);
  }
});

distube.on("queue.item.started", async ({ item }) => {
  const channel = client.channels.cache.get(item.metadata.textChannelId);
  if (channel?.isSendable()) await channel.send(`Now playing: ${item.song.name}`);
});

process.once("SIGINT", async () => {
  await distube.dispose();
  await client.destroy();
  process.exit(0);
});

await client.login(process.env.TOKEN);
```

`play` joins the member's voice channel, creates the guild's queue and adds the result. Its promise settles when the
track is in the queue, not when it starts, so the reply says "Added" and the `queue.item.started` listener
announces the real start. The metadata you pass travels with the queue item, which is how the listener finds the
text channel.

`skip` and `stop` need no voice channel, because the queue already holds the connection. `DisTubeError.is` tells
DisTube failures, such as nothing found, from your own bugs. [Errors](../../reference/errors/) lists the codes.

`dispose()` leaves every voice channel and releases the plugins. Call it before the process exits.

Next:

- [Play command](../../recipes/play-command/) covers search, the `next` option and playlists.
- [Now playing](../../recipes/now-playing/) announces added, failed and playlist events.
- [How DisTube works](../how-distube-works/) explains the queue, the voice and the lifecycle of `play`.
- [Events](../../reference/events/) and [options](../../reference/options/) list everything you can listen to and configure.
