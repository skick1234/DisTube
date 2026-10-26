---
title: Leave voice
description: Disconnect the bot when its queue ends or everyone else has left its voice channel.
sidebar:
  order: 11
---

DisTube never leaves a voice channel on its own. A voice stays connected until you call `voices.leave`, call
`dispose`, or Discord ends it, so when to leave is your bot's decision. These two listeners cover the usual
policies. Use either or both.

## Leave after the queue ends

A queue that runs out of items, or is stopped, is deleted and the voice stays connected with its volume and filters.
To leave when no new queue arrives in time:

```ts
import type { DisTube } from "distube";

declare const distube: DisTube;

const leaveDelayMs = 300_000;
const leaveTimers = new Map<string, NodeJS.Timeout>();

distube.on("queue.deleted", ({ guildId }) => {
  clearTimeout(leaveTimers.get(guildId));
  leaveTimers.set(
    guildId,
    setTimeout(() => {
      leaveTimers.delete(guildId);
      if (!distube.getQueue(guildId)) {
        void distube.voices.leave(guildId).catch(error => console.error("Leave failed", error));
      }
    }, leaveDelayMs),
  );
});

distube.on("queue.created", ({ guildId }) => {
  clearTimeout(leaveTimers.get(guildId));
  leaveTimers.delete(guildId);
});
```

`getQueue` is synchronous and sees a queue as soon as `play` registers it, before `queue.created` arrives, so a
`play` that lands just before the timer fires keeps the bot. `voices.leave` on a guild with no voice does nothing,
so a voice that already ended is harmless.

## Leave when the channel is empty

A bot that is playing to an empty channel keeps playing, so watch Discord's voice state updates and leave yourself.

```ts
import { Client, Events } from "discord.js";
import type { DisTube } from "distube";

declare const client: Client;
declare const distube: DisTube;

const emptyDelayMs = 30_000;
const timers = new Map<string, NodeJS.Timeout>();

function botIsAlone(guildId: string): boolean {
  const channelId = distube.voices.get(guildId)?.channelId;
  if (!channelId) return false;
  const channel = client.channels.cache.get(channelId);
  return channel?.isVoiceBased() === true && channel.members.every(member => member.user.bot);
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = newState.guild.id;
  const pending = timers.get(guildId);
  if (!botIsAlone(guildId)) {
    if (pending) clearTimeout(pending);
    timers.delete(guildId);
    return;
  }
  if (pending) return;
  timers.set(
    guildId,
    setTimeout(() => {
      timers.delete(guildId);
      if (botIsAlone(guildId)) {
        void distube.voices.leave(guildId).catch(error => console.error("Leave failed", error));
      }
    }, emptyDelayMs),
  );
});
```

Every voice state update in the guild runs the check. When only bots remain, the listener starts one timer. When
a person joins before it fires, the listener cancels it. When it fires, the listener checks again before it leaves,
so a member who rejoined at the last moment keeps the bot. `voices.leave` also deletes the queue. Needs the
`GuildVoiceStates` intent, which the discord.js adapter already requires.

## See also

- [Events reference](../../reference/events/) for `queue.deleted` and its reasons.
- [Voice settings](../voice-settings/) for the manual `/leave` command.
- [Events reference](../../reference/events/) for `voice.disconnected`.
