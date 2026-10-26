---
title: Shut down cleanly
description: Release voice connections and the Discord client when the process is stopped.
sidebar:
  order: 14
---

A signal handler that disposes DisTube first and then the Discord client, once, even when SIGINT and SIGTERM both arrive.

```ts
import { Client } from "discord.js";
import type { DisTube } from "distube";

declare const client: Client;
declare const distube: DisTube;

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
    void shutdown().catch(error => console.error("Shutdown failed", error));
  });
}
```

`distube.dispose()` deletes every queue, leaves every voice, then disposes the plugins in reverse order. Destroy the
Discord client after it, because leaving a voice needs the gateway. The client is still destroyed when `dispose` throws, and
both failures are reported together. SIGINT and SIGTERM share one cleanup. Each signal is handled once, so a
second Ctrl+C during cleanup exits the process at once. Under a process manager such as Docker or systemd, `SIGTERM` is the signal that
stops the bot.

## See also

- [Events reference](../../reference/events/) for `queue.deleted` with reason `shutdown` and `voice.disconnected`.
- Example bot: [index.ts](https://github.com/distubejs/example/blob/v6/src/index.ts).
