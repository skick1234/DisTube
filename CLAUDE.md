# CLAUDE.md - DisTube Development Guide

This document provides guidance for working with the DisTube codebase.

## Project Overview

DisTube is a powerful Discord.js music bot library written in TypeScript that simplifies music commands and enables effortless playback from various sources with integrated audio filters.

- **Node.js**: >= 22.12.0
- **Discord.js**: v14
- **Package Manager**: Bun
- **Build Tool**: tsup (dual ESM/CJS output)
- **Test Framework**: Vitest
- **Linter/Formatter**: Biome

## Quick Commands

```bash
bun install           # Install dependencies
bun run build         # Build the project (tsup)
bun run test          # Run tests (vitest)
bun run lint          # Check linting (biome ci)
bun run lint:fix      # Fix linting issues (biome check --write --unsafe)
bun run prettier      # Format code (biome format --write)
bun run type          # Type check (tsc --noEmit)
bun run docs          # Generate documentation (typedoc)
```

## Project Structure

```
src/
├── DisTube.ts              # Main class - extends TypedEmitter, orchestrates everything
├── index.ts                # Public API exports
├── type.ts                 # TypeScript type definitions, enums, interfaces
├── constant.ts             # Constants, default filters, audio config
├── util.ts                 # Utility functions (validation, type guards)
├── core/
│   ├── DisTubeBase.ts      # Abstract base class providing access to managers
│   ├── DisTubeHandler.ts   # URL/string resolution to Song/Playlist
│   ├── DisTubeOptions.ts   # Options validation and FFmpeg config
│   ├── DisTubeStream.ts    # FFmpeg stream handling
│   ├── DisTubeVoice.ts     # Voice connection management
│   └── manager/
│       ├── BaseManager.ts          # Generic Collection-based manager
│       ├── GuildIdManager.ts       # Base for guild-keyed managers
│       ├── QueueManager.ts         # Queue lifecycle management
│       ├── DisTubeVoiceManager.ts  # Voice connection management
│       └── FilterManager.ts        # Audio filter application
└── struct/
    ├── Song.ts             # Song class with metadata
    ├── Queue.ts            # Queue management (filters, repeat, autoplay)
    ├── Playlist.ts         # Playlist container
    ├── DisTubeError.ts     # Custom error class with 60+ predefined codes
    ├── Plugin.ts           # Abstract plugin base
    ├── ExtractorPlugin.ts  # Full-featured plugin (validate, resolve, search, stream)
    ├── InfoExtractorPlugin.ts    # Info-only plugin
    ├── PlayableExtractorPlugin.ts # Playable plugin (no search)
    └── TaskQueue.ts        # Sequential task queuing
```

## Architecture Patterns

### Event-Driven Architecture
- Uses `tiny-typed-emitter` for type-safe event emission
- 11 event types: `addList`, `addSong`, `playSong`, `finishSong`, `error`, `debug`, `ffmpegDebug`, `empty`, `finish`, `initQueue`, `noRelated`, `disconnect`, `deleteQueue`
- Queue emits events through parent DisTube instance

### Manager Pattern
- `BaseManager<V>` provides Collection-based storage
- `GuildIdManager` extends with guild-keyed storage
- Each manager handles lifecycle and state for its domain

### Plugin Architecture
Three plugin types with different capabilities:
- `ExtractorPlugin`: Full-featured (validate, resolve, search, getStreamURL)
- `InfoExtractorPlugin`: Info only (validate, resolve, createSearchQuery)
- `PlayableExtractorPlugin`: Playable only (validate, resolve, getStreamURL)

## Constants

Audio and timing constants are defined in `src/constant.ts`:

```typescript
AUDIO_SAMPLE_RATE = 48000      // Hz
AUDIO_CHANNELS = 2             // Stereo
DEFAULT_VOLUME = 50            // 0-100%
JOIN_TIMEOUT_MS = 30_000       // 30 seconds
RECONNECT_TIMEOUT_MS = 5_000   // 5 seconds
RECONNECT_MAX_ATTEMPTS = 5     // Max rejoin attempts
HTTP_REDIRECT_CODES            // Set of redirect status codes
MAX_REDIRECT_DEPTH = 5         // Max redirect follows
```

Always use these constants instead of magic numbers.

## Coding Conventions

### TypeScript
- Strict mode enabled with all strict checks
- Use `type` imports: `import type { ... } from "..."`
- Path aliases: `@/*` maps to `src/*`, `@` maps to `src/index.ts`
- No unused variables or parameters (enforced by tsconfig)
- Always use explicit return types for public methods
- Use `catch (e: unknown)` instead of `catch (e: any)`

### Error Handling
```typescript
// Good - type-safe error handling
catch (e: unknown) {
  const error = e instanceof Error ? e : new Error(String(e));
  const message = e instanceof Error ? (e.stack ?? e.message) : String(e);
}

// Bad - loses type safety
catch (e: any) {
  console.log(e.message);  // Unsafe
}
```

### Formatting (Biome)
- 2 spaces indentation
- 120 character line width
- Double quotes for strings
- Trailing commas everywhere
- Arrow functions: parentheses only when needed (`x => x`, `(a, b) => a + b`)

### Naming Conventions
- Classes: PascalCase (`DisTubeVoice`, `QueueManager`)
- Methods/Properties: camelCase (`getQueue`, `playSong`)
- Private fields: prefix with `#` or `_` for internal (`#getQueue`, `_beginTime`)
- Constants: UPPER_SNAKE_CASE (`AUDIO_SAMPLE_RATE`, `DEFAULT_VOLUME`)
- Enums: PascalCase with UPPER_SNAKE_CASE members

## Error Handling

### DisTubeError Class
Custom error class with predefined error codes and messages:

```typescript
// Static error (no parameters)
throw new DisTubeError("NO_QUEUE");

// Template error (with parameters)
throw new DisTubeError("INVALID_TYPE", "string", actualValue, "paramName");
throw new DisTubeError("FFMPEG_EXITED", exitCode);

// Custom error (new code with message)
throw new DisTubeError("CUSTOM_CODE", "Custom error message");
```

### Error Codes
Key error categories:
- Type validation: `INVALID_TYPE`, `EMPTY_ARRAY`, `EMPTY_STRING`, `INVALID_KEY`
- Voice operations: `NOT_IN_VOICE`, `VOICE_FULL`, `VOICE_CONNECT_FAILED`
- Queue operations: `NO_QUEUE`, `QUEUE_EXIST`, `NO_PREVIOUS`, `NO_UP_NEXT`
- Playback: `UNAVAILABLE_VIDEO`, `UNPLAYABLE_FORMATS`, `NON_NSFW`

### Validation Patterns
Use utility functions from `src/util.ts`:
```typescript
if (!isSupportedVoiceChannel(channel)) {
  throw new DisTubeError("INVALID_TYPE", "BaseGuildVoiceChannel", channel, "voiceChannel");
}
checkInvalidKey(options, validKeys, "options");
```

## Testing

### Test File Location
Tests mirror source structure: `tests/core/`, `tests/struct/`

### Mocking Patterns
```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DisTubeError, Queue } from "@";

vi.mock("@/core/DisTubeVoice");

const createMockVoice = () => ({
  id: "123",
  stop: vi.fn(),
  play: vi.fn(),
  on: vi.fn(),
  channel: { guild: { members: { me: {} } } },
}) as any;

describe("Queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should do something", () => {
    expect(result).toBe(expected);
  });
});
```

### Running Tests
```bash
bun run test              # Run all tests
bun run test -- --watch   # Watch mode
bun run test -- Queue     # Run specific test file
```

## Plugin Development

### Creating a Plugin
```typescript
import { ExtractorPlugin, type Song, type Playlist } from "distube";

export class MyPlugin extends ExtractorPlugin {
  override async validate(url: string): Promise<boolean> {
    return url.includes("myservice.com");
  }

  override async resolve<T>(url: string, options: ResolveOptions<T>): Promise<Song<T> | Playlist<T>> {
    // Fetch and return Song or Playlist
  }

  override async getStreamURL<T>(song: Song<T>): Promise<string> {
    // Return playable stream URL
  }

  override async searchSong<T>(query: string, options: ResolveOptions<T>): Promise<Song<T> | null> {
    // Search and return Song or null
  }
}
```

## Git Workflow

### Branch Strategy
- `main`: Production-ready code
- Feature branches for development

### Commit Messages
Follow Conventional Commits with PascalCase scope:
```
feat(Queue): add shuffle functionality
fix(Voice): handle reconnection failures
docs(README): update installation instructions
chore(Release): 5.1.2
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`

### Pre-commit Hooks (Husky)
- `pre-commit`: Runs `bun exec nano-staged` (Biome check on staged files)
- `commit-msg`: Validates commit message format

## Build & Release

### Build Output
tsup produces dual ESM/CJS output:
- `dist/index.js` (CJS)
- `dist/index.mjs` (ESM)
- `dist/index.d.ts` and `dist/index.d.mts` (types)

### Publishing Checklist
1. Update version in `package.json`
2. Run `bun run lint && bun run test`
3. Build: `bun run build`
4. Publish happens via GitHub Actions on release

## Debugging

### Debug Events
Listen to debug events for troubleshooting:
```typescript
distube.on(Events.DEBUG, console.log);
distube.on(Events.FFMPEG_DEBUG, console.log);
```

### Common Issues
1. **Missing intents**: Ensure `GuildVoiceStates` intent is enabled
2. **FFmpeg not found**: Install FFmpeg or set correct path in options
3. **Encryption libraries**: Install one of the supported encryption packages
4. **Age-restricted content**: Enable NSFW option or use NSFW channels

## Key Dependencies

- `tiny-typed-emitter`: Type-safe event emitter
- `undici`: HTTP client for URL handling
- `@discordjs/voice`: Voice connection management (peer dependency)
- `discord.js`: Discord API library (peer dependency)

## File Naming

- Source files: kebab-case or PascalCase matching class name
- Test files: `*.test.ts` suffix
- Types-only files: Named by content (`type.ts`, not `types.ts`)

## Deprecations (v5.2 → v6.0)

The following methods are deprecated and will be removed in v6.0:

### DisTube Shortcut Methods
Use `distube.getQueue(guild).method()` instead of `distube.method(guild)`:

| Deprecated | Replacement |
|------------|-------------|
| `distube.pause(guild)` | `distube.getQueue(guild).pause()` |
| `distube.resume(guild)` | `distube.getQueue(guild).resume()` |
| `distube.stop(guild)` | `distube.getQueue(guild).stop()` |
| `distube.setVolume(guild, vol)` | `distube.getQueue(guild).setVolume(vol)` |
| `distube.skip(guild, opts)` | `distube.getQueue(guild).skip(opts)` |
| `distube.previous(guild)` | `distube.getQueue(guild).previous()` |
| `distube.shuffle(guild)` | `distube.getQueue(guild).shuffle()` |
| `distube.jump(guild, num, opts)` | `distube.getQueue(guild).jump(num, opts)` |
| `distube.setRepeatMode(guild, mode)` | `distube.getQueue(guild).setRepeatMode(mode)` |
| `distube.toggleAutoplay(guild)` | `distube.getQueue(guild).toggleAutoplay()` |
| `distube.addRelatedSong(guild)` | `distube.getQueue(guild).addRelatedSong()` |
| `distube.seek(guild, time)` | `distube.getQueue(guild).seek(time)` |

### Queue Getter Methods
Use properties directly instead of getter methods:

| Deprecated | Replacement |
|------------|-------------|
| `queue.isPlaying()` | `!queue.paused` |
| `queue.isPaused()` | `queue.paused` |

### Queue Properties

| Deprecated | Replacement |
|------------|-------------|
| `queue.playing` | `!queue.paused` |
