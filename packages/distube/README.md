# distube

DisTube manages queues and playback. Adapters connect Discord platforms and SourcePlugins resolve media.

```ts
import { DisTube } from "distube";

const distube = new DisTube({ adapter, plugins });
const queue = distube.createQueue({ guildId, channelId });
await queue.enqueue(source);
```
