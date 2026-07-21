# DisTube v6

DisTube manages queues and playback, adapters connect platforms, plugins add capabilities, and examples teach usage.

## 1. Install

```bash
bun add distube @distube/discordjs @distube/youtube discord.js @discordjs/voice
```

## 2. Create DisTube

<!-- verify-ts -->
```ts
import { type Adapter, DisTube, type Plugin } from "distube";

declare const adapter: Adapter;
declare const plugins: readonly Plugin[];

const distube = new DisTube({ adapter, plugins });
```

Construction validates the adapter and initializes plugin instances synchronously. Call `await distube.shutdown()`
when the bot stops.

## 3. Configure an Adapter

```ts
import { DiscordJSAdapter } from "@distube/discordjs";

const adapter = new DiscordJSAdapter(client);
```

Use `OceanicAdapter` from `@distube/oceanic` for oceanic.js or `ErisAdapter` from `@distube/eris` for Eris 0.18.
Eris voice playback needs an Opus implementation and FFmpeg for non-Opus inputs; its Player rejects unsupported seek.
Adapters own platform connections and Player behavior; core sees only queue, guild, and channel IDs.

## 4. Add Plugins

```ts
import { YouTubePlugin } from "@distube/youtube";

const youtube = new YouTubePlugin();
const plugins = [youtube];
```

Official media plugins live in the independent plugins repository. Retain an instance to call typed provider search:

```ts
const results = await youtube.search("DisTube tutorial");
```

## 5. Create a Queue

```ts
const queue = distube.createQueue({ guildId: "guild-id", channelId: "voice-channel-id" });
```

The binding is explicit and stable. A second active queue cannot claim the same guild/channel pair.

## 6. Enqueue Media

```ts
await queue.enqueue("https://youtube.com/watch?v=example");
await queue.enqueue(results[0], { requestedBy: "user-id" });
```

`enqueue` is the only insertion method. Queue controls are `remove`, `skip`, `pause`, `resume`, `stop`, and `seek`.

## 7. Events

```ts
distube.on("queue.item.started", ({ queueId, item, timestamp }) => {
  console.log(queueId, item.song.title, timestamp);
});
```

The client emits `queue.created`, `queue.item.added`, `queue.item.started`, `queue.item.finished`,
`queue.item.failed`, and `queue.destroyed`. Events describe committed queue actions; bot code owns messages.

## 8. Advanced Extensions

Implement `Adapter` and `Player` from `distube` to connect another platform. Implement `SourcePlugin` to add a media
provider. Extensions import only public `distube` contracts, return canonical `Song` values, own their tests and
provider/platform policy, and verify packed public entry points. See the authoring guides and breaking migration guide
in `wiki/`.
