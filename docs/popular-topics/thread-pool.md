---
title: Size the thread pool and CPU
description: Set UV_THREADPOOL_SIZE and plan CPU for a bot that plays live streams or many tracks at once on the built-in engine.
sidebar:
  order: 4
---

This page is for a bot that plays live streams, or many tracks at once, on the built-in engine. It explains which
threads playback uses, how to size them with `UV_THREADPOOL_SIZE`, and how much CPU a track costs. A bot that uses
Lavalink can skip it. Lavalink plays on its own node and uses none of these threads.

## Two kinds of threads

The built-in engine decodes on its own worker threads. Opening an input and reading its bytes run somewhere else, on
the runtime's native thread pool.

Node.js and Bun both size that pool from `UV_THREADPOOL_SIZE` when it is set. When it is unset, Node.js starts 4
threads, and Bun starts one per CPU the process may run on, the count `os.availableParallelism()` reports. On Node.js
the pool is libuv's, and the whole process shares it, including DNS lookups, async `fs`, `crypto` and `zlib`.

## What holds a thread

- Opening an input holds one thread for a short time. The engine opens at most one input fewer than the pool has
  threads, and at least one, so a thread stays free for the rest of the process. It counts the pool the way the
  running runtime sizes it: `UV_THREADPOOL_SIZE` when set, otherwise 4 on Node.js and the CPU count on Bun. Further
  opens wait for a free slot.
- Reading a track's bytes holds a thread while the read waits for data. A download that is ahead of playback answers
  at once. A live track, such as an internet radio URL or a live `stream` resource, reads at the live edge, so it holds
  one thread for most of its playback. A live HLS track holds its thread while it waits for the next segment, which
  can take several seconds.

When live tracks hold every thread, the next track's open waits behind them. On Node.js, DNS lookups for the gateway
and for plugins wait too, and so do file reads.

## Pick a size

| Your bot                                    | `UV_THREADPOOL_SIZE`                    |
| ------------------------------------------- | --------------------------------------- |
| No live tracks, a few guilds                | leave the default                       |
| No live tracks, many guilds starting tracks | 8, or the default when it is larger     |
| Live tracks in up to N guilds at once       | N + 4, or the default when it is larger |

On Bun, a value below the default shrinks the pool, so on a host with many CPUs Bun may need no setting at all. Bun
ignores `UV_THREADPOOL_SIZE=1` and keeps its default.

On Node.js, libuv accepts up to 1024 and creates every thread at once on first use. An idle thread costs little: 1024
threads took 19 ms to start and added 8 MiB of resident memory, with 8 MiB of reserved stack each.

:::caution
If the host cannot create every thread, Node.js aborts the process the first time it uses the pool. A container
`pids.max`, a systemd `TasksMax` or a per-user process limit can cause it. Keep the size under the host's thread
limit.
:::

## Set it before the process starts

Set the variable in the environment that launches the bot:

```sh title="Shell"
UV_THREADPOOL_SIZE=16 node index.js
UV_THREADPOOL_SIZE=16 bun index.ts
```

```dockerfile title="Dockerfile"
ENV UV_THREADPOOL_SIZE=16
```

```ini title="systemd unit"
[Service]
Environment=UV_THREADPOOL_SIZE=16
```

On Node.js, when the host does not let you set the environment, preload a module that sets it:

```js title="threadpool.mjs"
process.env.UV_THREADPOOL_SIZE = "16";
```

```sh
node --import ./threadpool.mjs index.js
```

Bun sizes its pool from the environment it was launched with. A preload, or any other assignment to
`process.env.UV_THREADPOOL_SIZE`, leaves its pool unchanged.

### Why not set it in the bot's code

libuv reads `UV_THREADPOOL_SIZE` once, when the process first uses the pool, and never resizes it. Setting
`process.env.UV_THREADPOOL_SIZE` in your entry file works only if nothing has used the pool yet. One async file read,
DNS lookup or `crypto` call before that line, including one from an imported module, and libuv ignores the new value
with no error. On Bun it never works.

The engine reads the variable when it loads. A value the pool ignored also makes the engine count threads the process
does not have. That is why DisTube has no option for it.

## Plan CPU for a large bot

Decoding, filtering and encoding run on the engine's worker threads, separate from the thread pool above. Each
process starts at most `min(4, availableParallelism() - 1)` of them, and at least one. A new track goes to an idle
worker if there is one. Otherwise the engine starts another worker, up to that limit, and after that picks the worker
playing the fewest tracks. A worker with no tracks exits after 30 seconds.

So one process uses at most 4 cores for audio, however many the host has. A bot that needs more runs more processes,
such as shard clusters.

A track skips transcoding while its source is Opus at 48 kHz stereo in 20 ms packets, the volume is 100 and no filter
is set. A volume change, a filter, or a source in another codec, such as MP3 or AAC, makes it decode and re-encode
with libopus at `engine.opusComplexity`.

Here is what the engine costs per track, measured on an AMD Ryzen 9 7950X with Bun 1.4.4. Each run played 120 seconds
of synthetic stereo audio, pink noise and two tones, at a 64 kbps target, and summed the CPU time of every thread in
the process:

| Track                            | Share of one core |
| -------------------------------- | ----------------- |
| Opus, skips transcoding          | 0.1%              |
| MP3, complexity 10               | 0.8%              |
| MP3, complexity 5                | 0.65%             |
| Opus at volume 80, complexity 10 | 0.9%              |

A 128 kbps target added up to 0.1 points. The figures cover reading, decoding and encoding. They leave out encrypting
and sending packets to Discord. Content and CPU change them, so measure on your own host before you size one.
