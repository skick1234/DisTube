# @distube/eris

Direct Eris Adapter for DisTube v6.

Its Player accepts the public `{ itemId, resource }` playback request and sends only the prepared HTTP(S) URL to Eris.
It owns native listeners and connection teardown; core retains disposal ownership of the borrowed source resource.

```ts
import { ErisAdapter } from "@distube/eris";

const adapter = new ErisAdapter(client);
```

Construct the class directly; there is no create-adapter alias or public `playerFactory` option. Concurrent stop calls
join one terminal teardown, every native cleanup unit is attempted once, and unrecoverable disconnects retire the
Player before reporting the active item failure.

Eris voice playback requires one of its supported Opus implementations and the system tools required by Eris to
decode media. The initial verified peer line is Eris 0.18. Seeking is not supported and rejects with DisTube's normal
`VOICE_FAILED` mapping.
