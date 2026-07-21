# DisTube guide

Create the direct objects, bind a queue, and enqueue:

```ts
const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
const queue = distube.createQueue({ guildId, channelId });
await queue.enqueue("https://youtu.be/example");
```

Read `queue.state` for readonly waiting items, current item, and `idle | playing | paused` status. Use item IDs with
`remove`; use `skip`, `pause`, `resume`, `stop`, and `seek` for playback controls. Listen on the DisTube client for
dotted queue events and call `shutdown()` once during application teardown.
