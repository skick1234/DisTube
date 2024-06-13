There are a few ways to handle discord.js events

## Leave the voice channel if there is no user in it

```ts
import { isVoiceChannelEmpty } from "distube";
client.on("voiceStateUpdate", oldState => {
  if (!oldState?.channel) return;
  const voice = this.voices.get(oldState);
  if (voice && isVoiceChannelEmpty(oldState)) {
    voice.leave();
  }
});
```

## Pause the queue if there is no user in the voice channel and resume it if there is

```ts
import { isVoiceChannelEmpty } from "distube";
client.on("voiceStateUpdate", oldState => {
  if (!oldState?.channel) return;
  const queue = this.queues.get(oldState);
  if (!queue) return;
  if (isVoiceChannelEmpty(oldState)) {
    queue.pause();
  } else if (queue.paused) {
    queue.resume();
  }
});
```
