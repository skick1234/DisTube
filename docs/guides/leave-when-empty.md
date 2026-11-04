---
title: Leave voice
description: Disconnect the bot a while after its queue ends, or when everyone else has left its voice channel.
sidebar:
  order: 12
---

DisTube never leaves a voice channel on its own. The bot stays connected until you call `voices.leave` or `dispose`,
or until Discord ends the connection. When to leave is your bot's decision.

In this guide you add two listeners to `index.ts`. The first leaves a while after the queue ends. The second leaves
when nobody but bots is left in the channel. Use either one or both.

## Leave after the queue ends

When a queue runs out of tracks, a member runs `/stop`, or every track a `/play` asked for fails to load, DisTube
deletes the queue. The voice stays connected and keeps its volume and filters, and the next `/play` reuses the
connection. To leave if no new queue arrives within five minutes, add this to `index.ts`, after you create `distube`:

```ts title="index.ts"
const leaveDelayMs = 300_000;
const leaveTimers = new Map<string, NodeJS.Timeout>();

distube.on("queue.deleted", ({ guildId, reason }) => {
  if (reason !== "finished" && reason !== "stop" && reason !== "failed") return;
  clearTimeout(leaveTimers.get(guildId));
  leaveTimers.set(
    guildId,
    setTimeout(() => {
      leaveTimers.delete(guildId);
      if (!distube.getQueue(guildId)) {
        distube.voices.leave(guildId).catch(error => console.error("Leave failed", error));
      }
    }, leaveDelayMs).unref(),
  );
});

distube.on("queue.created", ({ guildId }) => {
  clearTimeout(leaveTimers.get(guildId));
  leaveTimers.delete(guildId);
});
```

Each guild gets its own timer. A deleted queue starts it, and a new queue cancels it.

The `reason` check skips the other deletions, `leave`, `voice-loss` and `shutdown`. In those the voice is gone or about
to go, so there is nothing to leave. `unref()` lets Node exit while a timer is still waiting. Without it, a timer
started shortly before you stop the bot would keep the process alive for up to five minutes after
[shutdown](../shutdown/).

The timer checks `getQueue` once more before it leaves. DisTube delivers events a moment after they happen, but
`getQueue` sees a new queue as soon as `play` creates it. So a `/play` that lands just before the timer fires keeps
the bot in the channel.

If the voice already ended, for example because someone disconnected the bot by hand, `voices.leave` does nothing.

## Leave when the channel is empty

A bot playing to an empty channel keeps playing. To stop that, watch Discord's voice state updates and leave once
only bots remain. Add this to `index.ts` below the other listeners. It uses the `Events` import that file already has.

```ts title="index.ts"
const emptyDelayMs = 30_000;
const emptyTimers = new Map<string, NodeJS.Timeout>();

function botIsAlone(guildId: string): boolean {
  const channelId = distube.voices.get(guildId)?.channelId;
  if (!channelId) return false;
  const channel = client.channels.cache.get(channelId);
  return channel?.isVoiceBased() === true && channel.members.every(member => member.user.bot);
}

client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
  const guildId = newState.guild.id;
  const pending = emptyTimers.get(guildId);
  if (!botIsAlone(guildId)) {
    clearTimeout(pending);
    emptyTimers.delete(guildId);
    return;
  }
  if (pending) return;
  emptyTimers.set(
    guildId,
    setTimeout(() => {
      emptyTimers.delete(guildId);
      if (botIsAlone(guildId)) {
        distube.voices.leave(guildId).catch(error => console.error("Leave failed", error));
      }
    }, emptyDelayMs).unref(),
  );
});
```

Every voice state update in the server runs the check:

1. When only bots remain in the bot's channel, the listener starts one 30 second timer.
2. When a person joins before it fires, the listener cancels it.
3. When it fires, the listener checks again before it leaves, so a member who rejoined at the last moment keeps the
   bot.

This timer calls `unref()` for the same reason as the first one.

The listener needs the `GuildVoiceStates` intent. Your client already has it, because the bot cannot join voice
without it.

:::caution
`voices.leave` also deletes the queue. Whatever was still waiting is gone when the bot leaves an empty channel, so
pick a delay long enough for a member who dropped out to reconnect.
:::

When the voice ends for any reason, DisTube emits `voice.disconnected` with a `reason`. The
[events reference](../../reference/events/) lists those reasons, and the reasons on `queue.deleted`.

## Next

[Shut down cleanly](../shutdown/) releases the voice connections when you stop the bot.
