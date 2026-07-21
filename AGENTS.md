# DisTube Repository

Follow the workspace orchestrator in `../AGENTS.md` and the active root OpenSpec artifacts. This repository owns the platform-neutral core and the two official platform adapters.

## Package ownership

- `packages/distube/`: DisTube client, QueueManager, GuildQueue, pure QueueState, Player/Adapter/Plugin contracts, media values, events, errors, and private utilities.
- `packages/discordjs/`: direct discord.js Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `packages/oceanic/`: direct Oceanic Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `packages/eris/`: direct Eris Adapter, connection/Player implementation, package-owned tests, and release metadata.
- `scripts/`: repository-owned boundary, inventory, API, docs, package, audit, cycle, and mutation gates.
- `website/` and `wiki/`: maintained public documentation. API Extractor/VitePress output is generated only through `bun run docs`.

Media provider implementations belong in `../plugins/`. `@distube/plugin-sdk`, `@distube/testkit`, public utilities/types packages, voice-plugin packages, and compatibility surfaces are forbidden.

## Commands

Use the Bun version pinned by package metadata and inspect `package.json` before citing commands. Release-relevant gates are:

```bash
bun run check
bun run type
bun run test
bun run build
bun run check:circular
bun run api-report
bun run check:packages
bun run check:adapter-compatibility
bun run docs
bun run test:mutation
bun run check:audit
```

Use focused package tests while iterating, then run every required repository gate. Never publish, commit, push, reset, clean, stash, or overwrite unrelated dirty-worktree changes without explicit authorization.

## Conventions

- Strict TypeScript; use `unknown` plus narrowing instead of `any`.
- Public integration contracts come directly from `distube`; tests and fixtures are package-local.
- QueueState transitions are pure. Plugin, Adapter, Player, listener, timer, and cleanup I/O stays outside transitions.
- GuildQueue is the only queue-state and event authority; Player owns effects only.
- Native discord.js/Oceanic/Eris objects remain inside the owning Adapter package.
- Public docs use DisTube, QueueManager, GuildQueue, QueueState, Song, QueueItem, Adapter, Player, Plugin, and SourcePlugin.
- Use Biome formatting: two spaces, double quotes, trailing commas, and the repository line-width policy.
