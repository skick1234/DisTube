---
title: Command handling
description: Split the quick-start file into one module per slash command and a small router.
sidebar:
  order: 1
---

The [quick start](../../get-started/quick-start/) keeps every command and its handler in `index.ts`. That works for
three commands and gets painful at twenty. On this page you split it into one file per command and a router in
`index.ts`. Every later guide adds one file to this layout.

When you are done, the project looks like this:

```
index.ts            creates the client and DisTube, registers and routes commands
commands/
  index.ts          the Command type, the command list and error replies
  play.ts           one file per command, added by the next guides
  queue.ts
  ...
```

:::note
Relative imports name the full file, such as `./commands/index.ts`, because Node.js runs TypeScript only when the
import says which file to load. Bun accepts them as they are. If your editor flags the `.ts` extension, set
`"allowImportingTsExtensions": true` and `"noEmit": true` in your `tsconfig.json`.
:::

## Define a command

Create `commands/index.ts`. It holds the types every command file shares, the list of commands and the text the bot
replies with when a command fails.

```ts title="commands/index.ts"
import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { type DisTube, DisTubeError, ErrorCode } from "distube";

export interface CommandMetadata {
  readonly requestedBy: string;
  readonly channelId: string;
}

export interface Command {
  readonly data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction<"cached">, distube: DisTube<CommandMetadata>): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction<"cached">, distube: DisTube<CommandMetadata>): Promise<void>;
}

export const commands: readonly Command[] = [];

const messages: Readonly<Record<ErrorCode, string>> = {
  [ErrorCode.INVALID_ARGUMENT]: "That request is not valid.",
  [ErrorCode.INVALID_STATE]: "That is not possible right now.",
  [ErrorCode.ABORTED]: "The request was cancelled.",
  [ErrorCode.NO_RESULT]: "Nothing found for that query.",
  [ErrorCode.NOT_FOUND]: "That item does not exist.",
  [ErrorCode.UNAVAILABLE]: "That item cannot be played.",
  [ErrorCode.RATE_LIMITED]: "The provider is rate limiting the bot. Try again later.",
  [ErrorCode.BOT_CHECK]: "The provider wants the bot to prove it is not a robot. Try again later.",
  [ErrorCode.NOT_STARTED]: "That premiere or live stream has not started yet.",
  [ErrorCode.SOURCE_FAILED]: "The provider could not load that.",
  [ErrorCode.VOICE_FAILED]: "The voice connection failed.",
  [ErrorCode.VOICE_DISCONNECTED]: "Lost the connection to the voice channel.",
  [ErrorCode.UNSUPPORTED]: "That does not work for this track.",
  [ErrorCode.AGE_RESTRICTED]: "That item is age-restricted.",
};

export function errorMessage(error: unknown): string {
  return DisTubeError.is(error) ? messages[error.code] : "Something went wrong.";
}
```

`CommandMetadata` is what the bot stores on every queue item it adds. DisTube never reads it. It hands it back on
every event for that item, so a listener knows who asked for a song and which text channel to post in. The quick
start kept only a channel id. The requester's id lets later messages credit them.

A `Command` is a module that exports `data`, the slash command definition Discord registers, and `execute`, which
runs when someone uses it. `autocomplete` is optional. [Search and autocomplete](../search-and-autocomplete/) uses
it to suggest queries while the member types.

The list starts empty. Each guide adds its module to it with two lines, for example:

- `import * as play from "./play.ts";` at the top of `commands/index.ts`
- `play` inside the `commands` array

TypeScript checks every module in the array against `Command`. A file that forgets `data` or misspells `execute`
shows an error in your editor, or when you run `tsc --noEmit`, instead of failing in Discord. Bun and Node.js
skip type checking when they run the bot.

:::note
The discord.js guide reads its command folder from disk at startup. An import list does the same job and lets
TypeScript check each module and follow it through a bundler. Use whichever you prefer. The rest of these guides
use the list.
:::

## Turn errors into replies

A DisTube call that fails throws or rejects with a `DisTubeError`. Its `code` says what went wrong, such as a search
with no match, a queue with nothing playing or a dropped voice connection. `errorMessage` turns that code into a
reply your members can read. The [errors reference](../../reference/errors/) explains each code.

`DisTubeError.is(error)` returns `true` only for DisTube errors, so a bug in your own code falls through to
"Something went wrong." Pass a code as well, as in `DisTubeError.is(error, ErrorCode.NO_RESULT)`, when one command
needs its own wording for one failure. [Play from a slash command](../play-command/) does that for age-restricted
media.

Typing the map as `Record<ErrorCode, string>` makes TypeScript list every code. When a DisTube update adds one, your
build tells you to write its message.

:::caution
Reply with your own text, never with `error.cause`. A provider's error can contain request details. Log the error
on your side if you need it.
:::

## Load and route commands

Replace the quick start's `index.ts` with this version. It sets up the client and DisTube the same way, then hands
each interaction to the command it names.

```ts title="index.ts"
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { Client, Events, GatewayIntentBits, type Interaction } from "discord.js";
import { DisTube } from "distube";
import { type CommandMetadata, commands, errorMessage } from "./commands/index.ts";

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
const distube = new DisTube<CommandMetadata>({
  adapter: new DiscordJSAdapter(client),
  plugins: [new YouTubePlugin()],
  onDiagnostic: ({ severity, stage, message }) => console.error(severity, stage, message),
});

const byName = new Map(commands.map(command => [command.data.name, command]));

client.once(Events.ClientReady, async ready => {
  await ready.application.commands.set(commands.map(command => command.data));
  console.log(`Logged in as ${ready.user.tag}`);
});

async function route(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    const command = byName.get(interaction.commandName);
    if (!command?.autocomplete || !interaction.inCachedGuild()) return;
    await command.autocomplete(interaction, distube).catch(() => interaction.respond([]));
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = byName.get(interaction.commandName);
  if (!command) return;
  if (!interaction.inCachedGuild()) {
    await interaction.reply("Use this command in a server.");
    return;
  }
  try {
    await command.execute(interaction, distube);
  } catch (error) {
    console.error(`/${interaction.commandName} failed`, error);
    const content = errorMessage(error);
    if (interaction.replied) await interaction.followUp(content);
    else if (interaction.deferred) await interaction.editReply(content);
    else await interaction.reply(content);
  }
}

client.on(Events.InteractionCreate, interaction => {
  route(interaction).catch(error => console.error("Interaction failed", error));
});

distube.on("queue.item.started", async ({ item }) => {
  const channel = client.channels.cache.get(item.metadata.channelId);
  if (channel?.isSendable()) {
    await channel.send({ content: `Now playing: ${item.song.name}`, allowedMentions: { parse: [] } });
  }
});

process.once("SIGINT", async () => {
  await distube.dispose();
  await client.destroy();
  process.exit(0);
});

await client.login(process.env.TOKEN);
```

Here is what changed from the quick start:

- `DisTube<CommandMetadata>` types the metadata. Every `play` call must pass a `requestedBy` and a `channelId`, and
  every event hands them back typed.
- `onDiagnostic` prints what DisTube reports while it works, such as one of your event listeners throwing. It is
  the first place to look when playback misbehaves.
- On ready, the bot registers the `data` of every command in the list. Registering on every start keeps Discord in
  sync with your files, so a renamed option never lingers.
- `route` looks up the command by name and calls it. Autocomplete requests go to the command's `autocomplete`, and
  a failure there answers with no suggestions.
- When `execute` throws, the router replies with `errorMessage`. It checks whether the command already replied or
  deferred, because Discord accepts only one first reply per interaction.

The `inCachedGuild()` check gives each command a `ChatInputCommandInteraction<"cached">`. That type knows the
member and their voice channel, which `/play` needs to join it.

:::tip
Let errors escape your commands. The router already turns them into replies in one place. A command catches an
error only when it wants different wording, and rethrows everything else.
:::

The command list is still empty, so this bot registers no commands yet, and the quick start's `/play`, `/skip` and
`/stop` are gone for now. The next page brings `/play` back, and [queue controls](../queue-controls/) brings back
`/skip` and `/stop`.

## Next

[Play from a slash command](../play-command/) writes `commands/play.ts`.
