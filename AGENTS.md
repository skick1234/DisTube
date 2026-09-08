# DisTube Repository

Follow `../AGENTS.md` and the active root OpenSpec change. This repository owns the platform-neutral core, three official platform adapters and private bundled voice-core. Its baseline specs live under `../openspec/specs/distube/`; the active change records the API migration and validation status.

## Package ownership

- `packages/distube/`: DisTube client, private queue registry, DisTubeGuild, pure GuildState, DisTubeVoice, integration contracts, media values, events and errors.
- `packages/discordjs/`: direct discord.js Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `packages/oceanic/`: direct Oceanic Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `packages/eris/`: direct Eris Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `packages/voice-core/`: private playback machinery bundled into owning adapters, never an independent published package.
- `scripts/`: repository-owned boundary, inventory, API, docs, package, audit, cycle, and critical-quality gates.
- `website/` and `wiki/`: maintained public documentation. API Extractor/VitePress output is generated only through `bun run docs`.

Media provider implementations belong in `../plugins/`. `@distube/plugin-sdk`, `@distube/testkit`, public utilities/types packages, voice-plugin packages, and compatibility surfaces are forbidden.

## Commands

Use the Bun version pinned by package metadata and inspect `package.json` before citing commands. Release-relevant gates are:

```bash
bun run check
bun run type
bun run test:release
bun run build
bun run check:prepared-build
bun run check:circular
bun run api-report:prepared
bun run check:packages:prepared
bun run check:adapter-compatibility:prepared
bun run docs:prepared
bun run check:critical-quality
bun run check:audit
```

`bun run verify` performs one coverage-enabled behavior pass and one four-package build, then uses fingerprint-checked
prepared output for API, package, compatibility, and documentation consumers. The unsuffixed consumer commands remain
self-sufficient and build when prepared evidence is missing or stale.

Use focused package tests while iterating, then run every required repository gate. Never publish, commit, push, reset, clean, stash, or overwrite unrelated dirty-worktree changes without explicit authorization.

## Conventions

- Strict TypeScript; use `unknown` plus narrowing instead of `any`.
- Public integration contracts come from the type-only `distube/integrations` entry; tests and fixtures are package-local.
- GuildState transitions are pure. Source, Adapter, Player, listener, timer and cleanup I/O stays outside transitions.
- DisTubeGuild is the only queue-state and event authority; Player owns effects only.
- Native discord.js/Oceanic/Eris objects remain inside the owning Adapter package.
- Application docs start with direct `distube.play(channel, input)` and use the readonly DisTubeGuild/DisTubeVoice facades. Author docs use the integration entry. Only DisTube, DisTubeError, Song and Playlist are runtime root exports.
- Register and reserve a queue before asynchronous work. Queue deletion resets filters through acknowledged backend cleanup; volume, repeat and autoplay survive. Check the active change before syncing these working-tree contracts to the baseline.
- Use Biome formatting: two spaces, double quotes, trailing commas, and the repository line-width policy.
