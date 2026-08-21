# DisTube guide

Create the direct objects and play:

```ts
const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
const { queue } = await distube.play({ guildId, voiceChannelId }, "https://youtu.be/example");
```

Read `queue.state` for readonly waiting items, optional current item, and `idle | playing | paused` status
(`QueueStatus`). Insert more with `queue.enqueue`; use item IDs or one-based waiting positions with `remove` and
`jump`; use `skip`, `previous`, `shuffle`, `clear`, `pause`, `resume`, `seek`, `setVolume`, `setRepeatMode`,
`setAutoplay`, and `queue.filters` for controls. `queue.stop()` deletes the queue while the guild's Voice stays
connected; `distube.voices.leave(guildId)` releases the Voice itself. Look queues up by guild with
`distube.getQueue(guildId)`, listen on the DisTube client with the `Events` enum, and call `shutdown()` once during
application teardown.
