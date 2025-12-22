# Handling Discord.js Events

DisTube provides utilities to help you handle Discord.js events for better user experience.

## Leave the voice channel if there is no user in it

```javascript
import { isVoiceChannelEmpty } from "distube";

client.on("voiceStateUpdate", oldState => {
  if (!oldState?.channel) return;
  const voice = distube.voices.get(oldState);
  if (voice && isVoiceChannelEmpty(oldState)) {
    voice.leave();
  }
});
```

## Pause the queue if there is no user in the voice channel and resume it if there is

```javascript
import { isVoiceChannelEmpty } from "distube";

client.on("voiceStateUpdate", oldState => {
  if (!oldState?.channel) return;
  const queue = distube.getQueue(oldState);
  if (!queue) return;
  if (isVoiceChannelEmpty(oldState)) {
    queue.pause();
  } else if (queue.paused) {
    queue.resume();
  }
});
```

## Leave voice channel after a period of inactivity

```javascript
import { Events } from "distube";

const inactivityTimers = new Map();

// Start timer when queue finishes
distube.on(Events.FINISH, queue => {
  const timer = setTimeout(() => {
    queue.voice.leave();
    inactivityTimers.delete(queue.id);
  }, 5 * 60 * 1000); // 5 minutes

  inactivityTimers.set(queue.id, timer);
});

// Clear timer when new song plays
distube.on(Events.PLAY_SONG, queue => {
  const timer = inactivityTimers.get(queue.id);
  if (timer) {
    clearTimeout(timer);
    inactivityTimers.delete(queue.id);
  }
});

// Clear timer when queue is deleted
distube.on(Events.DELETE_QUEUE, queue => {
  const timer = inactivityTimers.get(queue.id);
  if (timer) {
    clearTimeout(timer);
    inactivityTimers.delete(queue.id);
  }
});
```

## Handle bot being moved to another channel

```javascript
client.on("voiceStateUpdate", (oldState, newState) => {
  // Check if it's the bot
  if (oldState.member?.id !== client.user?.id) return;

  // Bot was moved to a different channel
  if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const queue = distube.getQueue(oldState.guild.id);
    if (queue) {
      queue.textChannel?.send(`Moved to <#${newState.channelId}>`);
    }
  }
});
```
