---
title: Quick start
description: Build a discord.js music bot in one file, with /play, /skip and /stop.
sidebar:
  order: 3
---

On this page you build a working music bot in a single `index.ts` file. It registers three slash commands, `/play`,
`/skip` and `/stop`, and announces each track in the channel where someone asked for it. The steps below build the
file piece by piece. If you'd rather run it first and read later, copy [the whole file](#the-whole-file) at the end.

You need the discord.js packages from [installation](../installation/) and your bot's token.

## Keep the token out of your code

Your token is your bot's password. Put it in a `.env` file next to `index.ts` instead of in the code:

```sh title=".env"
TOKEN=your-token-goes-here
```

:::caution
Anyone with the token can log in as your bot. If you use Git, add `.env` to `.gitignore` so you never commit it.
:::

Bun reads `.env` on its own. Node.js reads it when you start it with `--env-file=.env`, as shown in
[run the bot](#run-the-bot).

## Create the client

Start with the imports and a discord.js client. These are all the imports the finished file uses.

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { DisTube, DisTubeError } from "distube";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
```

The bot needs two intents. `Guilds` gives it the servers and channels it is in. `GuildVoiceStates` tells it who is in
which voice channel, which the voice connection needs to join and `/play` needs to find the member's channel.

## Create DisTube

```ts title="index.ts"
interface Metadata {
  readonly textChannelId: string;
}

const distube = new DisTube<Metadata>({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
});
```

`DiscordJSAdapter` connects DisTube to your client. It joins voice channels and plays the audio. `YouTubePlugin` is
the source. It turns a YouTube link or a search query into something DisTube can play. You can list more plugins in
the array, and DisTube asks them in order.

`Metadata` is data you attach to each request. DisTube never reads it. It stores it on every queue item, and every event
that carries an item hands it back to you. Here it holds the text channel ID, so the bot knows where to announce a track when it starts.

## Register the commands

```ts title="index.ts"
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
```

`setContexts(InteractionContextType.Guild)` hides the commands in DMs, because music needs a voice channel in a
server. The bot registers the commands once it is ready.

## Handle /play

```ts title="index.ts"
async function play(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  await interaction.deferReply();
  const { items } = await distube.play(channel, interaction.options.getString("input", true), {
    metadata: { textChannelId: interaction.channelId },
  });
  await interaction.editReply(`Added ${items.length} ${items.length === 1 ? "track" : "tracks"} to the queue.`);
}
```

`distube.play` joins the member's voice channel, creates the server's queue and adds what
it found. Finding a track can take a few seconds, so the handler calls `deferReply()` first to tell Discord an answer
is coming.

The promise resolves `{ queue, items }` once the items are in the queue. That is before the first one starts playing,
which is why the reply says "Added" and not "Now playing". `items` holds exactly what this call added: one item for a
song, one per song for a playlist. Each item carries the `metadata` you passed.

## Handle /skip and /stop

```ts title="index.ts"
async function skip(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("Nothing is playing.");
    return;
  }
  const next = await queue.skip();
  await interaction.reply(next ? `Skipped. Up next: ${next.song.name}.` : "Skipped. Nothing is waiting.");
}

async function stop(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("Nothing is playing.");
    return;
  }
  await queue.stop();
  await interaction.reply("Stopped.");
}
```

Neither command needs the member's voice channel, because the queue already holds the connection.
`distube.getQueue` returns `undefined` when the server has no queue.

`skip` resolves the item that plays next, or `undefined` when nothing is waiting. It does not wait for that item to
start. `stop` clears the queue and deletes it. The bot stays in the voice channel, unless it was still joining.

## Route the interactions

```ts title="index.ts"
const handlers = new Map([
  ["play", play],
  ["skip", skip],
  ["stop", stop],
]);

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  const handler = handlers.get(interaction.commandName);
  if (!handler) return;
  try {
    await handler(interaction);
  } catch (error) {
    const message = DisTubeError.is(error) ? `Could not do that: ${error.message}` : "Something went wrong.";
    if (interaction.deferred) await interaction.editReply(message);
    else await interaction.reply(message);
  }
});
```

`inCachedGuild()` makes sure the command came from a server the bot is in, which also types `interaction.member` as
a full member with a voice state.

Things go wrong in a music bot. A search finds nothing, or a video is private. `DisTubeError.is` tells those DisTube
failures apart from bugs in your own code, so the member gets a useful message for the first kind. The
[errors reference](../../reference/errors/) lists every code.

## Announce each track

```ts title="index.ts"
distube.on("queue.item.started", async ({ item }) => {
  const channel = client.channels.cache.get(item.metadata.textChannelId);
  if (channel?.isSendable()) await channel.send(`Now playing: ${item.song.name}`);
});
```

`queue.item.started` fires when the track becomes audible. The listener reads the text channel ID back from the
item's metadata.

## Shut down cleanly

```ts title="index.ts"
process.once("SIGINT", async () => {
  await distube.dispose();
  await client.destroy();
  process.exit(0);
});

await client.login(process.env.TOKEN);
```

`dispose()` leaves every voice channel and releases the plugins. Call it before the process exits, so the bot does
not linger in voice channels.

## Run the bot

The file uses `import` and top-level `await`. With Node.js, set `"type": "module"` in your `package.json`.

```sh title="Node.js"
node --env-file=.env index.ts
```

```sh title="Bun"
bun index.ts
```

Once the console prints `Logged in as`, join a voice channel in your server and run `/play` with a song name.

## The whole file

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import {
  type ChatInputCommandInteraction,
  Client,
  Events,
  GatewayIntentBits,
  InteractionContextType,
  SlashCommandBuilder,
} from "discord.js";
import { DisTube, DisTubeError } from "distube";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });

interface Metadata {
  readonly textChannelId: string;
}

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

async function play(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const channel = interaction.member.voice.channel;
  if (!channel) {
    await interaction.reply("Join a voice channel first.");
    return;
  }
  await interaction.deferReply();
  const { items } = await distube.play(channel, interaction.options.getString("input", true), {
    metadata: { textChannelId: interaction.channelId },
  });
  await interaction.editReply(`Added ${items.length} ${items.length === 1 ? "track" : "tracks"} to the queue.`);
}

async function skip(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("Nothing is playing.");
    return;
  }
  const next = await queue.skip();
  await interaction.reply(next ? `Skipped. Up next: ${next.song.name}.` : "Skipped. Nothing is waiting.");
}

async function stop(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
  const queue = distube.getQueue(interaction.guildId);
  if (!queue) {
    await interaction.reply("Nothing is playing.");
    return;
  }
  await queue.stop();
  await interaction.reply("Stopped.");
}

const handlers = new Map([
  ["play", play],
  ["skip", skip],
  ["stop", stop],
]);

client.on(Events.InteractionCreate, async interaction => {
  if (!interaction.isChatInputCommand() || !interaction.inCachedGuild()) return;
  const handler = handlers.get(interaction.commandName);
  if (!handler) return;
  try {
    await handler(interaction);
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

## Next

The file works, but it grows with every command you add. [Command handling](../../guides/command-handling/) splits it
into one file per command, and the guides after it add the queue, pause, volume, filters and more.

To see what happens between `play` and the first note, read [how DisTube works](../how-distube-works/). The
[events](../../reference/events/) and [options](../../reference/options/) references list everything you can listen
to and configure.
