# DisTube v6 documentation

Start with the repository README to install packages, configure an adapter and ordered sources, and call
`distube.play(voiceChannel, input)`. The client hands back a `DisTubeQueue` for scheduling (add, jump, previous,
shuffle, remove, repeat, autoplay, history) and a `DisTubeVoice` for the connection and its settings (volume,
filters, self-deaf, self-mute, direct playback without a queue).

Use Quick Start for a complete snippet, the Guide for queue and voice controls, Events and Timing for the event list
and ordering, Error Handling for codes and `DisTubeError.is`, and `MIGRATION.md` in the repository root for the v5
and v6 pre-release tables. Extension authors use the type-only `distube/integrations` entry point and the Adapter
and SourcePlugin authoring pages.
