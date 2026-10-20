# SourcePlugin authoring

A SourcePlugin needs a non-empty `name`, `stream(song, context)` and at least one callable discovery
operation, `resolve` or `search`. Both discovery methods are optional in the interface so classes can use
`implements SourcePlugin`; client construction enforces the at-least-one rule. `related`, `suggest`,
`initialize` and `dispose` are independently optional. Do not add no-op methods for missing capabilities.

Declare `SourcePlugin<PluginData>` to type the provider data on every Song. Return `Song` and `Playlist` values
from public `distube`; core creates QueueItems. Each returned Song must have the configured source name.
`resolve` returns a Song, an ordered Playlist or `undefined` to decline. A recognized provider failure throws.

Core decides which of the two a string is, and it never asks both. A string that parses as an absolute `http:` or
`https:` URL goes to `resolve`; every other non-empty string is a query and goes to `search`. That includes a provider
URI such as `spotify:track:…`, which core cannot distinguish from a typed query like `artist: song title`. Accept your
URI scheme in `search` if you want to keep serving it. A URL every plugin declines fails with `SOURCE_FAILED`; core
does not retry it as a query. A query every plugin declines fails with `NO_RESULT`.

```ts
import { Song } from "distube";
import type { PlaybackContext, PlaybackPreparation, SourcePlugin } from "distube/integrations";

interface ExampleData {
  readonly plays: number;
}

export class ExampleSource implements SourcePlugin<ExampleData> {
  readonly name = "example";

  async resolve(url: string): Promise<Song<ExampleData> | undefined> {
    if (url !== "https://example.audio/track/1") return undefined;
    return new Song({
      source: this.name,
      id: "1",
      name: "Example track",
      url,
      pluginData: { plays: 9 },
    });
  }

  async stream(_song: Song<ExampleData>, context: PlaybackContext): Promise<PlaybackPreparation> {
    context.signal.throwIfAborted();
    return {
      kind: "resource",
      resource: { kind: "url", url: "https://cdn.example/audio.mp3", seekable: true },
    };
  }
}
```

This resolve-only example serves one catalog entry. A real provider reacquires its playback URL inside `stream`.
For a search-only catalog, implement `search` and omit `resolve`. Explicit public search on a resolve-only
source rejects `UNSUPPORTED`.

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit`, and a zero-based `offset`. Document your
own default and maximum `limit` in the package README, reject a `limit` or `offset` outside those bounds with
`INVALID_ARGUMENT` before issuing any provider request, and never return more than the effective limit. Return results
in the order your provider ranked them; core consumes that ranking and never re-ranks across sources. An empty array is
how you decline a query, and it is not an error.

Discovery and preparation have different failure policies:

| Operation                                | Missing method or decline                                                                  | Exception or malformed result                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| URL resolution                           | Skip absent `resolve`; continue on `undefined`                                             | Reject                                         |
| Query used by `play`, `add` or `resolve` | Skip absent `search`; continue on `[]`                                                     | Record safe failure and try the next source    |
| Public `search`                          | Implicit search skips absent methods; explicit source rejects `UNSUPPORTED`; `[]` is valid | Reject immediately                             |
| Explicit playback fallback               | Skip origin and absent `search`; continue on `[]`                                          | Record safe failure and continue within bounds |

Search must return an array of Songs owned by that source. A Song, Playlist, object or `undefined` is malformed.
Ordinary query resolution takes the first candidate from the first non-empty answer. It does not fall back if
that Song later fails to stream.

Only `{ kind: "search", query }` starts playback fallback. Core searches each eligible source once in configured
order, tries up to five ranked candidates per source and at most 25 preparations overall. It deduplicates by
source and Song ID. A candidate returning another search request is skipped without recursion. Incompatible
resources are cleaned up before trying the next candidate. Compatibility includes the selected engine's resource
kinds, encoded formats and optional synchronous `supportsResource` check for options such as URL headers. Player
activation failure ends the attempt.
Clean exhaustion is `NO_RESULT`; exhaustion with recorded failures is `SOURCE_FAILED`.

`suggest(query, options?)` returns at most 25 provider completions as strings. `distube.getSuggestions` calls the
named source, or the first configured source with `suggest` that returns a non-empty list. An empty list declines. On
a provider error, report a diagnostic and return an empty list rather than throwing.

`related(song, context)` receives `context.exclude`, the queue's recent history Songs. Avoid returning one of them.
`queue.addRelated()` and autoplay both use it.

`PluginContext.diagnostic()` accepts structured `{ severity, stage, message, error?, detail? }` records; the runtime
adds the Plugin name and isolates callback throws or rejections. `initialize`, when present, must finish
synchronously and must not return a Promise. Constructors validate options only; make the first provider request on
first use. Diagnostics must redact credentials, tokens, query strings, and prepared URLs.

`stream` returns one of two shapes. A streaming source returns a resource: a fresh `url`, absolute `file`, Node `stream`, or format-qualified `encoded` resource.
See [direct inputs](Direct-Inputs.md) for shape, seekability and single-use cleanup rules. A
metadata-only source returns one trimmed non-empty provider-derived search query instead. Core performs only that
explicit bounded fallback, keeps the original QueueItem public, and owns exactly-once source-resource disposal. The
Player only borrows the resource.

## Errors

Throw `DisTubeError` with your own codes for provider outcomes a bot wants to distinguish: not found, unavailable,
age restricted, rate limited. Export them as a `const` object prefixed with your upper-case plugin name. Core preserves
a plugin `DisTubeError` code and safe message/cause, sanitizing unsafe nested data, so a bot can write
`DisTubeError.is(error, ExampleErrorCode.NOT_FOUND)`. A non-DisTube error is wrapped once as `SOURCE_FAILED` with
a safe cause. Malformed constructor options use `INVALID_ARGUMENT`; `initialize` and `dispose` failures
use `PLUGIN_FAILED`. Messages must never carry credentials, signed URLs or encoded track data.

| Source outcome                                  | Public result                                                  |
| ----------------------------------------------- | -------------------------------------------------------------- |
| URL or query outside this source                | `undefined` from `resolve`, or `[]` from `search`              |
| Every queried source declines                   | `NO_RESULT` from core                                          |
| Invalid `limit` or `offset`                     | `INVALID_ARGUMENT` before a provider request                   |
| Known provider failure                          | Your prefixed `DisTubeError` code, with safe details           |
| Malformed result or unexpected provider failure | `SOURCE_FAILED` with a safe cause                              |
| Initialization or disposal failure              | `PLUGIN_FAILED`; core still attempts the other owned disposers |

## Song and playlist fields

Song exposes fixed `source`, `id`, `name` and canonical `url` fields, optional `duration` (seconds), `thumbnail` and
`artist`, and `pluginData`. `formattedDuration` is a getter core computes. Playlist exposes `source`, `id`, `name`,
canonical `url`, optional `thumbnail`, readonly Songs, `pluginData`, and computed `duration` and `formattedDuration`.
Core permits an absent duration; each source defines its normalization. The official YouTube source normalizes
missing or invalid duration to zero, which `formattedDuration` renders as `Live`.

Put provider display data such as view counts, uploader names and live flags in `pluginData`. Core stores the
reference and never reads, clones or freezes it. Keep signed URLs, fallback candidates and temporary playback
details out of it; they belong in `stream` with a bounded lifetime. Caller metadata belongs to QueueItem as an
optional readonly binding; core never freezes or clones its contents.

Expand a collection to a documented bound, in provider order, and say what that bound is in the package README. Check
the supplied `AbortSignal` between pages so a cancelled expansion issues no further request, and drop an entry the
provider marks unavailable rather than failing the page it sits on.

## Package boundaries

Keep authentication, URL/network policy, retries, metadata mapping, collection ordering, fixtures, and cleanup in the
provider package. `@distube/plugin-network` is an optional helper the official plugins use for redaction and URL
policy; the contract does not require it. Import no private core paths, SDK, testkit, registry, role, manifest,
capability graph, cross-plugin lifecycle hook, or public resource manager.

An official package may expose a typed provider constructor option. Injected providers are advanced supported seams,
not unvalidated shortcuts: they must honor AbortSignals and lifecycle disposal, return correctly owned Songs and safe
playback outcomes, and pass the same shape, pagination, destination/redirect/body/final-URL, and redaction validation
as the default provider.

Import author interfaces with `import type` from `distube/integrations` and runtime `Song`, `Playlist` and
`DisTubeError` values from `distube`. Sources are fixed at construction; there is no runtime registry. A dual-role
source/engine must be supplied explicitly in both fields. Core orders lifecycle ownership as configured sources
followed by the selected engine, deduplicates by identity, and disposes hooked instances once in reverse order. No
integration instance may be owned by two live clients.

## Lifecycle and data ownership

| Stage                    | Author obligation                               | Core behavior                                                           |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| Constructor              | Validate local options; no provider requests    | Validate supplied callable members before hooks                         |
| `initialize`, if present | Return synchronously, never a Promise           | Reserve all configured identities before the first hook                 |
| Initialization failure   | Allow cleanup even after partial initialization | Dispose entered identities, including the failing one, in reverse order |
| `stream`                 | Honor cancellation and return a fresh resource  | Own late results and cleanup after cancellation                         |
| `dispose`, if present    | Join owned work and release provider resources  | Call once per entered identity; finish track cleanup first              |

A dispose-only source is valid. A shared source/engine instance enters lifecycle once. Another live client cannot
claim it until disposal or rollback settles. Unvisited reservations are released without calling their disposer.

`new Song<ExampleData>(...)` requires `pluginData`; types allowing `undefined` may omit it. Core preserves
provider-data and caller-metadata references. Do not put paths, signed URLs, authentication headers or encoded
tracks in either public media fields or provider data.
