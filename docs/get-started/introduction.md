---
title: Introduction
description: What DisTube does for a Discord music bot, what you need before you start, and how these docs are laid out.
sidebar:
  order: 1
---

DisTube is a music library for Discord bots. You hand it a voice channel and a link or search query, and it finds the
track, joins the channel and plays it. This guide takes you from an empty folder to a music bot with slash commands
for playing, skipping, browsing the queue, filters and more.

## What DisTube does

DisTube takes care of the parts of a music bot that are the same in every bot:

- Finding media. Source plugins turn a YouTube, SoundCloud or Spotify link, or a plain search query, into a Song or a
  Playlist.
- Voice. DisTube joins the channel, keeps one connection per guild and holds its volume, filters, self-deaf and
  self-mute.
- The queue. Each guild has one queue with the current track, the upcoming tracks, a short history, repeat and
  autoplay.
- Playback. The adapter's built-in engine decodes and sends the audio. A Lavalink node can do that job instead.
- Events. Your bot hears when a track is added, starts, finishes or fails.

## What stays in your bot

DisTube never talks to your members. Everything a member sees is your code:

- Slash commands, their options and their replies.
- Where to announce tracks. You attach your own metadata, such as a text channel ID, to each request, and DisTube
  hands it back on the item in each event.
- Rules about who may do what, such as only letting members in the bot's channel skip.
- Leaving voice. DisTube never leaves a channel on its own, so you decide when the bot goes.

## Before you start

You need:

- Node.js `^22.22.2 || ^24.15.0 || >=26.0.0`, or Bun.
- A Discord bot built with discord.js or Oceanic. If you have not made one yet, the
  [discord.js guide](https://discordjs.guide/) walks you through creating the application and inviting the bot.
- The `Guilds` and `GuildVoiceStates` gateway intents. The voice connection needs voice state updates to join, and
  your commands need them to see which channel a member is in.
- The Connect and Speak permissions in the voice channels where the bot plays.

You should be comfortable with JavaScript, `async` and `await`, and a little discord.js. The examples are TypeScript,
but every one of them works as JavaScript once you delete the types.

## How these docs are laid out

- **Get started.** Install DisTube, build a one-file bot in the [quick start](../quick-start/), and read
  [how DisTube works](../how-distube-works/). Coming from v5? Read [updating from v5](../migration/).
- **Guides.** One bot, built page by page. [Command handling](../../guides/command-handling/) splits the quick-start
  file into command files, and each following guide adds one feature, from `/play` to a clean shutdown.
- **Plugins.** The [official plugins](../../plugins/) for YouTube, SoundCloud, Spotify, yt-dlp and Lavalink, with
  their options.
- **Popular topics.** Standalone pages you can read in any order, such as the [FAQ](../../popular-topics/faq/) and
  [sound clips](../../popular-topics/soundboard/).
- **Reference.** Every [option](../../reference/options/), [queue control](../../reference/queue/),
  [event](../../reference/events/) and [error code](../../reference/errors/).
- **Extending.** Write your own [plugin](../../extending/plugin-authoring/) or
  [adapter](../../extending/adapter-authoring/).

## Getting help

Stuck? Ask in the [DisTube Discord server](https://discord.gg/feaDd9h). Found a bug? Open an issue on
[GitHub](https://github.com/skick1234/DisTube/issues) with your DisTube version, the code that fails and the error
it throws.

Ready? [Install DisTube](../installation/).
