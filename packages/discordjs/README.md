# @distube/discordjs

Direct discord.js Adapter for DisTube.

Its Player accepts the public `{ itemId, resource }` playback request and decodes progressive HTTP(S) URLs,
absolute files or one-shot Node readables. Core owns resource cleanup after the Player detaches it.

```ts
import { DisTube } from "distube";
import { YouTubePlugin } from "@distube/youtube";
import { DiscordJSAdapter } from "@distube/discordjs";

declare const client: ConstructorParameters<typeof DiscordJSAdapter>[0];
declare const voiceChannel: import("discord.js").VoiceBasedChannel;

const music = new DisTube({ adapter: new DiscordJSAdapter(client), sources: [new YouTubePlugin()] });
const queue = await music.play(voiceChannel, "a song title");
await queue.add("another song", { next: true });
await queue.pause();
await queue.resume();

const voice = queue.voice;
await voice?.setVolume(80);
await voice?.filters.set("bassboost", 15);
```

Pass the native channel directly. The adapter checks voice capability and guild membership before joining.
Author contracts live in `distube/integrations`; the root entry contains application types and values.
`queue.stop()` deletes the queue and keeps the voice connected with its volume, filters, self-deaf and self-mute.
`voice.leave()` or `music.voices.leave(guildId)` releases the connection and those settings. Await `music.dispose()` for terminal cleanup.

Construct the class directly; the options are `connectionTimeoutMs` and `filters`. There is no create-adapter alias
or public `playerFactory` option. Concurrent stop calls join one terminal teardown, every native cleanup unit is
attempted once, and unrecoverable disconnects retire the Player before reporting the active track failure.

## Voice state and filters

`play` and `music.voices.join` send self-deaf on and self-mute off unless the join options say otherwise. The
session implements `setSelfDeaf` and `setSelfMute` as acknowledged gateway updates, so `voice.setSelfDeaf(false)`
resolves after Discord confirms the new state.

```ts
const joined = await music.voices.join(voiceChannel, { selfDeaf: false, selfMute: false });
await joined.setSelfDeaf(true);
```

The engine ships the conventional presets (`3d`, `bassboost`, `earwax`, `echo`, `flanger`, `gate`, `haas`,
`karaoke`, `mcompand`, `nightcore`, `phaser`, `reverse`, `surround`, `tremolo`, `vaporwave`). Three of them take a
value: `bassboost` from 0 to 20 (default 10, label `Bass +10dB`), `nightcore` from 1 to 2 (default 1.25) and
`vaporwave` from 0.5 to 1 (default 0.8). The rest are fixed and reject a value with `INVALID_ARGUMENT`. Add or
override presets at construction; `render` returns a plain libavfilter graph fragment.

```ts
const adapter = new DiscordJSAdapter(client, {
  filters: {
    bassboost: { render: (value = 12) => `bass=g=${value}`, default: 12, min: 0, max: 30, label: v => `Bass +${v}dB` },
    slowed: { render: () => "asetrate=48000*0.85,aresample=48000" },
  },
});
```

`voice.filters.definitions` reports each preset's range, default and label, so a command can build choices from it.
Filters and volume persist across queue stop and reset when the voice leaves.

The default engine reports `capabilities.seek: true`. Files seek through FFmpeg input seeking. A URL marked
`seekable: true` reopens its request and decodes to the offset, which can cost time and bandwidth. One-shot streams
and URLs without that flag reject seek with `UNSUPPORTED`. An active filter change that needs a decoder restart
also rejects for nonseekable input; initial filters remain available.

## Local playback requirements

Use Node 22.12.0 or later. Install FFmpeg and expose `ffmpeg` on `PATH`, or set `FFMPEG_PATH` to its executable.
Install one Opus encoder: `@discordjs/opus` or `opusscript`.
Install one voice encryption implementation: `sodium-native`, `sodium`, `libsodium-wrappers`,
`@stablelib/xchacha20poly1305`, or `@noble/ciphers`.

This adapter's default engine accepts `url`, `file` and `stream` playback resources. An `encoded` resource rejects
with `UNSUPPORTED`; select an engine that declares its format to play it.

Node opens URL bodies with copied headers and refuses redirects, then streams them into FFmpeg without passing the
URL or credentials as process arguments. FFmpeg also decodes absolute files and submitted readables. HLS/DASH and
nested network requests from the decoder are unsupported.

The selected local engine checks these prerequisites when it creates a Player for playback. A gateway-only join
and an explicitly selected remote engine do not run the local codec or FFmpeg checks. A missing local prerequisite
rejects playback with `VOICE_FAILED` and names the missing dependency.
