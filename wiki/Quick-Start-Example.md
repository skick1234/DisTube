# Quick start

```ts
import { DiscordJSAdapter } from "@distube/discordjs";
import { YouTubePlugin } from "@distube/youtube";
import { DisTube } from "distube";

const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
distube.on("queue.item.started", ({ item }) => console.log(item.song.title));

const queue = distube.createQueue({ guildId, channelId });
await queue.enqueue("https://youtu.be/example");
```

The runnable example repository shows Discord interaction replies, queue lookup, all events, all error codes, and
shutdown using packed public packages.

For Eris, replace the Adapter construction with `new ErisAdapter(client)` from `@distube/eris`; queue and event code
stays platform-neutral. Eris 0.18 requires an Opus implementation for voice and does not support `queue.seek()`.
