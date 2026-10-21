---
"distube": major
"@distube/discordjs": major
"@distube/oceanic": major
---

DisTube v6 separates guild voice connections from queue scheduling. `DisTubeVoice` owns the connection, Player,
direct playback, volume, bitrate and filters. `DisTubeQueue` schedules tracks through the public voice API and
owns repeat, autoplay and bounded history. Stopping or exhausting a queue keeps the voice and its audio settings;
leaving voice releases them.

Configure an adapter and one ordered `plugins` array. At most one plugin may carry an engine, which replaces the
adapter's built-in engine. Built-in filter definitions, connection timeout and the `engine.opusComplexity` and
`engine.bufferMs` settings belong to `DisTubeOptions`, not adapter constructors. The supported adapters are
`@distube/discordjs` and `@distube/oceanic`.

`await voice.play(resource)` settles with a `TrackEnd` when playback finishes, stops or is replaced. A new play
replaces the current track, including one scheduled by a queue; replacing a queued track deletes that queue.
`voice.setBitrate` selects an encoder bitrate or follows the channel bitrate with `"auto"`.

Integration authors use `Plugin`, `Adapter`, `VoiceSession`, `Engine` and `Player` from `distube/integrations`.
`VoiceSession.join` applies deaf and mute state, and sessions expose the channel bitrate. `Engine.prepare` can
prepare every Song, and `Player.play` returns the track's final outcome instead of publishing track events.

`Song` and `Playlist` carry typed `pluginData`; queue-item metadata belongs to the caller. Source failures use
core error codes including `NOT_FOUND`, `UNAVAILABLE` and `RATE_LIMITED`, with the plugin name in
`DisTubeError.source` and the original failure as `cause`. Queue events report scheduled playback; direct voice
playback reports its outcome through the returned promise.
