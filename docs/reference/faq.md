---
title: FAQ
description: Short answers that no recipe or reference page covers.
sidebar:
  order: 6
---

For how to do something, see the [play command recipe](../../recipes/play-command/). For what a method does, see the
[queue](../queue/), [voice](../voice-and-filters/), [events](../events/) and [errors](../errors/) references.

## Can the bot join a stage channel?

Yes. The bot joins suppressed and a user promotes it to speaker. DisTube checks Connect but not Speak for a stage
channel, so the join succeeds without it. Audio is heard once the bot is promoted, on the same voice connection.

## Why did the bot leave on its own?

DisTube never leaves by itself. Check `voice.disconnected`: reason `removed` means a member or moderator
disconnected the bot, `platform` means the connection dropped and carries the error, and `left` means your code
called `leave`. To leave on purpose after the queue ends or the channel empties, see
[leave voice](../../recipes/leave-when-empty/).

## Why is a provider URI treated as a query?

Only absolute HTTP or HTTPS URLs go to a plugin's `resolve`. Other strings, including `spotify:track:...`, go to
`search`, because DisTube cannot tell a URI from a query like `artist: song title`. Use the provider's HTTPS URL, or
write a plugin whose `search` accepts the URI scheme. See [plugins and their order](../../get-started/how-distube-works/#plugins-and-their-order).

## Which package handles voice?

The adapter creates the voice session and supplies the built-in engine. The official adapters are
`@distube/discordjs` and `@distube/oceanic`. A plugin with an `engine`, such as Lavalink, replaces the built-in
engine. Put it in `plugins` like any other source.

## Does DisTube send Discord replies?

No. Your code sends messages from [events](../events/) and turns [errors](../errors/) into replies. Call
`await distube.dispose()` when the bot stops, as in [shutdown](../../recipes/shutdown/).
