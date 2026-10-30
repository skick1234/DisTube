---
title: Shut down cleanly
description: Leave every voice channel and close the Discord client once when the process is told to stop.
sidebar:
  order: 13
---

When you stop the bot, it should leave its voice channels and log out instead of vanishing mid-song. In this guide
you replace the quick start's `SIGINT` listener with a shutdown that handles both stop signals and reports every
failure.

## The shutdown function

In `index.ts`, delete the `process.once("SIGINT", ...)` block and add this in its place:

```ts title="index.ts"
let shutdownPromise: Promise<void> | undefined;

function shutdown(): Promise<void> {
  shutdownPromise ??= (async () => {
    const errors: unknown[] = [];
    try {
      await distube.dispose();
    } catch (error) {
      errors.push(error);
    }
    try {
      await client.destroy();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length > 0) throw new AggregateError(errors, "Shutdown failed");
  })();
  return shutdownPromise;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    shutdown().catch(error => console.error("Shutdown failed", error));
  });
}
```

## What happens on shutdown

`distube.dispose()` does three things in order:

1. It deletes every queue. Each one emits `queue.deleted` with the reason `shutdown`.
2. It leaves every voice channel. Each voice emits `voice.disconnected`.
3. It disposes the plugins, in the reverse of the order you listed them.

If a step fails, `dispose` still runs the rest and then rejects with one `DisTubeError`. Its `cause` is an
`AggregateError` holding every failure. Calling `dispose` again returns the same promise.

The function destroys the Discord client after `dispose`, because leaving a voice channel needs the gateway
connection. It destroys the client even when `dispose` fails, and then throws both failures together.

## Why two signals and `once`

Ctrl+C in a terminal sends `SIGINT`. Docker, systemd and most process managers send `SIGTERM` to stop the bot. Both
signals share one `shutdownPromise`, so the cleanup runs once even when both arrive.

`process.once` handles each signal only the first time. If cleanup hangs, a second Ctrl+C reaches Node's default
handler and exits the process at once.

:::tip
The example bot runs the same `shutdown` when its startup fails partway, so a bot that could not log in still
releases what it created. See its [bot.ts](https://github.com/distubejs/example/blob/v6/discordjs/bot.ts).
:::

## Where to go from here

Your bot now plays, queues, announces, filters and cleans up after itself. That is the end of the guide.

[Popular topics](../../popular-topics/faq/) covers questions that do not fit one bot: the FAQ, short sound clips,
playing direct links and sizing the thread pool. The [reference](../../reference/options/) lists every option,
queue method, voice setting, event and error code.
