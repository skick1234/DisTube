---
title: Size the thread pool
description: Set UV_THREADPOOL_SIZE for a bot that plays live streams or starts many tracks at once on the built-in engine.
sidebar:
  order: 15
---

The built-in engine decodes on its own worker threads, but opening an input and reading its bytes run on the libuv
thread pool. Node.js shares that pool across the whole process, including DNS lookups, async `fs`, `crypto` and `zlib`,
and gives it 4 threads unless `UV_THREADPOOL_SIZE` says otherwise. This page applies to Node.js. Lavalink plays on its
own node and uses none of these threads.

## What holds a thread

- Opening an input holds one thread briefly. The engine opens at most `UV_THREADPOOL_SIZE - 1` inputs at once, and at
  least one, so a thread stays free for the rest of the process. Further opens wait for a free slot.
- Reading a track's bytes holds a thread while the read waits for data. A download that is ahead of playback answers at
  once. A live track, such as an internet radio URL or a live `stream` resource, reads at the live edge, so it holds one
  thread for most of its playback. A live HLS track holds its thread while it waits for the next segment to be
  published, which can take several seconds.

When live tracks hold every thread, everything else that uses the pool waits behind them: the next track's open,
DNS lookups for the gateway and for plugins, and file reads.

## Recommended size

| Bot                                         | `UV_THREADPOOL_SIZE` |
| ------------------------------------------- | -------------------- |
| No live tracks, a few guilds                | leave the default, 4 |
| No live tracks, many guilds starting tracks | 8                    |
| Live tracks in up to N guilds at once       | N + 4                |

libuv accepts up to 1024 and creates every thread at once on first use. An idle thread costs little: 1024 threads took
19 ms to start and added 8 MiB of resident memory, with 8 MiB of reserved stack each. If the host cannot create them all,
because of a container `pids.max`, a systemd `TasksMax` or a per-user process limit, Node.js aborts at that first use.
Keep the size under the host's thread limit.

## Set it before the process starts

Set the variable in the environment that launches the bot:

```sh title="Shell"
UV_THREADPOOL_SIZE=16 node index.js
```

```dockerfile title="Dockerfile"
ENV UV_THREADPOOL_SIZE=16
```

```ini title="systemd unit"
[Service]
Environment=UV_THREADPOOL_SIZE=16
```

When the host does not let you set the environment, preload a module that sets it:

```js title="threadpool.mjs"
process.env.UV_THREADPOOL_SIZE = "16";
```

```sh
node --import ./threadpool.mjs index.js
```

## Why not set it in the bot's code

libuv reads `UV_THREADPOOL_SIZE` once, when the process first uses the pool, and never resizes it. Setting
`process.env.UV_THREADPOOL_SIZE` in your entry file works only if nothing has used the pool yet. One async file read,
DNS lookup or `crypto` call before that line, including one from an imported module, and the new value is ignored with
no error. DisTube has no option for it for the same reason.
