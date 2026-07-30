# @distube/oceanic

Direct Oceanic Adapter for DisTube.

Its Player accepts the public `{ itemId, resource }` playback request, creates native audio only from the prepared
HTTP(S) resource URL, and terminalizes before connection teardown. Core—not this Adapter—disposes the source resource.

```ts
const adapter = new OceanicAdapter(client);
```
