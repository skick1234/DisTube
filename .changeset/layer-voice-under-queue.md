---
"distube": major
"@distube/discordjs": major
"@distube/eris": major
"@distube/oceanic": major
---

Layer voice under queue. `DisTubeVoice` owns the connection, the Player, direct track playback (`play`, `stop`,
`pause`, `resume`, `seek`, `position`, `leave`), volume, a filter manager with values and labels, and self-deaf and
self-mute. `DisTubeGuild` becomes `DisTubeQueue`, a scheduler over one voice with `add` (`next`/`at`), `jump`,
`previous`, `shuffle`, `clear`, range `remove`, `addRelated`, bounded `history`, and queue-owned repeat and autoplay.
Queue deletion no longer resets filters. `DisTube` gains `search` and `getSuggestions` typed by the source instance
and a `historySize` option. `Song<PluginData>` gains `pluginData` and `formattedDuration`; `Playlist` gains
`duration`. `DisTubeError<Code>` adds `DisTubeError.is`, a `const` `ErrorCode` with `NO_RESULT`, and plugin codes pass
through unchanged. `SourcePlugin` requires only `name`, `resolve`, `search` and `stream` (renamed from
`preparePlayback`). `VoiceSession.join` and `createVoiceSession` accept `{ selfDeaf, selfMute }` and the session
exposes `setSelfDeaf`/`setSelfMute`; `Engine` declares `filters` metadata and `capabilities.seek` and drops
`resolvable`. The Eris adapter's `selfDeaf`/`selfMute` constructor options are removed in favour of join options.
Removed: `DisTubeGuild`, `GuildState`, `VoiceSettings`, `voice.setFilters`, `voice.setRepeat`, `voice.setAutoplay`,
`FilterEntry.payload`.
