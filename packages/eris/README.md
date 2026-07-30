# @distube/eris

Direct Eris Adapter for DisTube v6.

Its Player accepts the public `{ itemId, resource }` playback request and sends only the prepared HTTP(S) URL to Eris.
It owns native listeners and connection teardown; core retains disposal ownership of the borrowed source resource.

```ts
import { ErisAdapter } from "@distube/eris";

const adapter = new ErisAdapter(client);
```

Eris voice playback requires one of its supported Opus implementations and the system tools required by Eris to
decode media. The initial verified peer line is Eris 0.18. Seeking is not supported and rejects with DisTube's normal
`VOICE_FAILED` mapping.
