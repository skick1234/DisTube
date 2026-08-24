# DisTube guide

Create the direct objects and play:

```ts
const youtube = new YouTubePlugin();
const distube = new DisTube({ adapter: new DiscordJSAdapter(client), plugins: [youtube] });
const { queue } = await distube.play({ guildId, voiceChannelId }, "https://youtu.be/example");
const { queue: searched } = await distube.play({ guildId, voiceChannelId }, "never gonna give you up");
```

`play`, `queue.enqueue`, and `distube.resolve` all take the same input: a query string, a URL string, a `Song`, or a
`Playlist`. A string is a URL only when it parses as an absolute `http:` or `https:` URL, and every other non-empty
string is a query. A URL is offered to each configured plugin's `resolve` in order and fails if all of them decline;
it is never retried as a query. A query is searched across the same plugins in the same order, and the first plugin
that returns anything wins. A plugin whose search throws does not stop the search, so one provider being down still
plays the track if a later one has it.

Read `queue.state` for readonly waiting items, optional current item, and `idle | playing | paused` status
(`QueueStatus`). Insert more with `queue.enqueue`; use item IDs or zero-based waiting positions with `remove` and
`jump`; use `skip`, `previous`, `shuffle`, `clear`, `pause`, `resume`, and `seek` for queue controls. Volume, repeat
mode, autoplay, filters, and played history belong to the guild's Voice: `distube.voices.get(guildId)` exposes
`setVolume`, `setRepeatMode`, `setAutoplay`, `filters`, and `previousSongs`, and they outlive every queue.
`queue.stop()` deletes the queue while the guild's Voice stays connected; `distube.voices.leave(guildId)` releases the
Voice itself, which is what discards those five values. Look queues up by guild with
`distube.getQueue(guildId)`, listen on the DisTube client with the `Events` enum, and call `shutdown()` once during
application teardown. Waiting positions are zero-based, so `jump(0)` and `remove(0)` both address the next track.
Queues carry no public ID. An `INVALID_ARGUMENT` rejection also carries `error.reason`, which is `argument` for a
value that fails the contract and `state` for a well-formed call the queue currently forbids.
