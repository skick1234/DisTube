# distube

DisTube manages queues and playback. Adapters connect Discord platforms; SourcePlugins resolve canonical media and
prepare fresh playable input.

```ts
import { DisTube } from "distube";

const distube = new DisTube({ adapter, plugins });
const queue = distube.createQueue({ guildId, channelId });
const items = await queue.enqueue(source); // insertion acknowledgement
distube.on("queue.item.started", ({ item }) => console.log(item.id));
```

`Song.url` is canonical provider identity, not native audio input. SourcePlugins return a disposable URL resource or an
explicit fallback search request during just-in-time preparation. Players receive only the original item ID and that
prepared resource. Core keeps fallback values private and owns source-resource disposal.
