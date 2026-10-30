---
title: FAQ
description: Short answers to the questions people ask most about DisTube.
sidebar:
  order: 1
---

Short answers to common questions, each with a link to the page that covers it in full. If yours is not here, ask in
the [DisTube Discord server](https://discord.gg/feaDd9h).

## Playback

### Why does YouTube say "Sign in to confirm you're not a bot"?

YouTube sends this answer most often to bots on datacenter and VPS addresses. The YouTube plugin raises it as a
`BOT_CHECK` error. Retrying does not help. The bot's owner has to give the plugin a signed-in cookie or a PO token.
[Sign in with a cookie](../../plugins/youtube/#sign-in-with-a-cookie) walks you through the cookie, and the
[errors reference](../../reference/errors/#bot-check) shows how to catch the code.

### Why does a video fail with `AGE_RESTRICTED`?

DisTube refuses age-restricted media unless the call allows it. Pass `allowAgeRestricted: true` to `play`, `queue.add`
or `search` when the guild allows it:

```ts
import type { DisTube, VoiceChannelTarget } from "distube";

declare const distube: DisTube;
declare const channel: VoiceChannelTarget;

await distube.play(channel, "a song query", { allowAgeRestricted: true });
```

Without the option, a Playlist keeps its other Songs and drops the age-restricted ones. The provider can still refuse a
video when the bot has no age-verified account, and that also rejects `AGE_RESTRICTED`. v5's `nsfw` option is gone,
because the answer now belongs to each call rather than the whole client.

### How do I play a direct audio link or an uploaded file?

Write a small plugin for it. v5's direct-link and file plugins are retired, and
[Play direct audio links and attachments](../direct-links/) has one you can copy. To play a fixed set of clips, see
[Play short sound clips](../soundboard/).

### Why is a `spotify:` URI searched as text?

DisTube sends only absolute HTTP and HTTPS URLs to a plugin's `resolve`. Every other string goes to `search`, because
DisTube cannot tell a URI from a query like `artist: song title`. Use the provider's HTTPS URL instead. If you need the
URI scheme, write a plugin whose `search` accepts it. [Plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order)
explains the lookup.

## Voice

### Why did the bot leave the voice channel?

DisTube never leaves on its own. Listen for `voice.disconnected` and read its `reason`:

- `removed` means a member or a moderator disconnected the bot.
- `platform` means the connection dropped and could not recover. The event carries the error.
- `left` means your code called `leave`.

### How do I make the bot leave when the queue ends or the channel empties?

Write it in your bot. DisTube has no option for it, so your code decides when to leave.
[Leave voice](../../guides/leave-when-empty/) has both listeners.

### Why can't the bot join my voice channel?

When a join fails, `play` rejects `VOICE_FAILED` and the adapter's error is its `cause`. The usual reasons are a channel
that denies the bot Connect or Speak, a client without the `GuildVoiceStates` intent, and a join that took longer than
`connectionTimeoutMs`, 15 seconds by default. Log `error.cause` to your console to see which one it was.

### Can the bot join a stage channel?

Yes. The bot joins as a suppressed listener, and a member promotes it to speaker. DisTube checks Connect but not Speak
on a stage channel, so the join works without Speak. Members hear audio once the bot is promoted, on the same voice
connection.

### Which package handles voice?

The adapter. `@distube/discordjs` and `@distube/oceanic` create the voice session and bring the built-in engine. A
plugin with an `engine`, such as Lavalink, replaces the built-in engine. Put it in `plugins` like any other source.

## Coming from v5

### Why does `distube.on("playSong", ...)` throw?

v6 renamed every event. `on` throws `INVALID_ARGUMENT` for a name it does not know, so a v5 name fails when the bot
starts instead of never firing. The [events reference](../../reference/events/#from-v5) maps each v5 name to its v6
event.

### Where did the `error` event go?

It split in two. A command that cannot add its media gets the error as the rejection of `play` or `queue.add`, so catch
it where you reply. A track that fails later, while it loads or plays, fires `queue.item.failed`. A listener that
throws reaches the `onDiagnostic` option.

### Why is `await distube.play(...)` not a queue anymore?

`play` resolves `{ queue, items }`. `queue` is the guild's queue, and `items` holds the items this call added. Write
`const { queue, items } = await distube.play(...)`. The [queue reference](../../reference/queue/#adding) has an example.

### Do I still need FFmpeg?

No. The built-in engine decodes with the `node-av` native binding, so there is no ffmpeg binary and no `ffmpeg` option.
`node-av` needs glibc 2.28 or newer, so musl hosts such as Alpine cannot run it. A bot that uses Lavalink needs neither.
See the [hosting requirements](../../get-started/installation/#hosting).

### Does DisTube send messages to Discord?

No. Your code sends every message. Reply from your commands, announce from [events](../../reference/events/), and turn
[errors](../../reference/errors/) into replies. To know where to announce, pass the text channel's ID as `metadata` when
you call `play`, then read `item.metadata` in the listener. The [quick start](../../get-started/quick-start/) does
exactly that.

## Running the bot

### Where can I host the bot?

Any host that meets the [hosting requirements](../../get-started/installation/#hosting). The
Premium DisTube Bots run on [skick.xyz/vps](https://skick.xyz/vps), with plans from US$4 a month.

### Should I set `UV_THREADPOOL_SIZE`?

Only if the bot plays live streams, such as internet radio, in several guilds at once, or starts tracks in many guilds.
[Size the thread pool and CPU](../thread-pool/) has a table of values.

### What should the bot do when it stops?

Call `await distube.dispose()`. It deletes every queue, leaves every voice and disposes the plugins.
[Shut down cleanly](../../guides/shutdown/) shows where to call it.
