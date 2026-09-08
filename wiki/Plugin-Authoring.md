# SourcePlugin authoring

A SourcePlugin is a direct instance with `name`, synchronous `initialize(context)`, `dispose()`, cancellable
`search(query, options?)` and `resolve(url, options?)`, required `preparePlayback(song, context)`, and optional
`related(song, context)` for autoplay continuations (an absent member is treated as a decline). Return canonical
`Song` and `Playlist` values from public `distube`; core creates QueueItems. `resolve` returns a single `Song`, a
`Playlist` for collection URLs, or `undefined` only to decline the URL. Every returned Song must use the exact
configured source name. Once a plugin recognizes a URL or accepts preparation, throw on provider failure instead of
silently falling through.

Core decides which of the two a string is, and it never asks both. A string that parses as an absolute `http:` or
`https:` URL goes to `resolve`; every other non-empty string is a query and goes to `search`. That includes a provider
URI such as `spotify:track:…`, which core cannot distinguish from a typed query like `artist: song title`. Accept your
URI scheme in `search` if you want to keep serving it. A URL every plugin declines fails with `SOURCE_FAILED`; core
does not retry it as a query.

<!-- verify-ts -->
```ts
import type {
  PlaybackContext,
  PlaybackPreparation,
  PluginContext,
  RelatedContext,
  SearchOptions,
  SourceOperationOptions,
  SourcePlugin,
} from "distube/integrations";
import { Song } from "distube";

class ExampleSource implements SourcePlugin {
  readonly name = "example";
  initialize(_context: PluginContext): void {}
  dispose(): void {}
  async search(_query: string, _options?: SearchOptions): Promise<readonly Song[]> { return []; }
  async resolve(_url: string, _options?: SourceOperationOptions): Promise<undefined> { return undefined; }
  async related(_song: Song, _context: RelatedContext): Promise<Song | undefined> { return undefined; }
  async preparePlayback(song: Song, context: PlaybackContext): Promise<PlaybackPreparation> {
    if (song.source !== this.name || context.signal.aborted) throw new Error("invalid preparation");
    return {
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/audio", dispose: () => undefined },
    };
  }
}
```

`search(query, options?)` takes `SearchOptions`: an `AbortSignal`, a `limit`, and a zero-based `offset`. Document your
own default and maximum `limit` in the package README, reject a `limit` or `offset` outside those bounds with
`INVALID_ARGUMENT` before issuing any provider request, and never return more than the effective limit. Return results
in the order your provider ranked them; core consumes that ranking and never re-ranks across sources. An empty array is
how you decline a query, and it is not an error.

Core searches its configured sources in constructor order, skips any it already visited on the current chain, calls
`search` at most once per source, and stops at the first source that returns anything. A search that throws is recorded
and the chain moves on, so a later source can answer after an earlier failure. Two callers share
that rule and differ only in how many of your candidates they consume: resolving a typed query takes one, and
substituting a stream for a metadata-only source tries up to five.

`PluginContext.diagnostic()` accepts structured `{ severity, stage, message, error?, detail? }` records; the runtime
adds the Plugin name and isolates callback throws or rejections. Initialization must finish synchronously and must not
return a Promise. Diagnostics must redact credentials, tokens, query strings, and prepared URLs.

`preparePlayback` returns one of two shapes. A streaming source returns a resource: a fresh absolute HTTP(S) `url`
resource acquired immediately before playback, or an `encoded` track for engines that play provider-encoded media. A
metadata-only source returns one trimmed non-empty provider-derived search query instead. Core performs only that
explicit bounded fallback, keeps the original QueueItem public, and owns exactly-once source-resource disposal. The
Player only borrows the resource.

Song exposes fixed source, id, name and canonical URL fields, plus optional duration, thumbnail and artist.
Artist is a string. Playlist exposes source, id, name, canonical URL, optional thumbnail and readonly Songs.
Omit absent or invalid optional values rather than fabricating data. Unknown duration stays absent. Keep
provider-specific payloads, live flags, counts and temporary playback details private with a bounded lifetime.
Caller metadata belongs to QueueItem as an optional readonly binding; core never freezes or clones its contents.

Expand a collection to a documented bound, in provider order, and say what that bound is in the package README. Check
the supplied `AbortSignal` between pages so a cancelled expansion issues no further request, and drop an entry the
provider marks unavailable rather than failing the page it sits on.

Keep authentication, URL/network policy, retries, metadata mapping, collection ordering, fixtures, and cleanup in the
provider package. Import no private core paths, SDK, testkit, registry, role, manifest, capability graph, cross-plugin
lifecycle hook, or public resource manager. Do not cache prepared URLs or fallback candidates on Song metadata.

An official package may expose a typed provider constructor option. Injected providers are advanced supported seams,
not unvalidated shortcuts: they must honor AbortSignals and lifecycle disposal, return correctly owned Songs and safe
playback outcomes, and pass the same shape, pagination, destination/redirect/body/final-URL, and redaction validation
as the default provider.

Import author interfaces with import type from distube/integrations and runtime Song/Playlist/DisTubeError values
from distube. Sources are fixed at construction; there is no runtime registry. A dual-role source/engine must be
supplied explicitly in both fields. Core orders lifecycle ownership as configured sources followed by the selected
engine, deduplicates by identity, and disposes hooked instances once in reverse order. No integration instance may be owned by two live clients.
