# SourcePlugin authoring

A SourcePlugin is a direct instance with `name`, synchronous `initialize(context)`, `dispose()`, cancellable
`search(query, options?)` and `resolve(url, options?)`, required `preparePlayback(song, context)`, and optional
`related(song, context)` for autoplay continuations (an absent member is treated as a decline). Return canonical
`Song` and `Playlist` values from public `distube`; core creates QueueItems. `resolve` returns a single `Song`, a
`Playlist` for collection URLs, or `undefined` only to decline the URL. Every returned Song must use the exact
configured source name. Once a plugin recognizes a URL or accepts preparation, throw on provider failure instead of
silently falling through.

<!-- verify-ts -->
```ts
import type {
  PlaybackContext,
  PlaybackPreparation,
  PluginContext,
  RelatedContext,
  SourceOperationOptions,
  SourcePlugin,
} from "distube";
import { Song } from "distube";

class ExampleSource implements SourcePlugin {
  readonly name = "example";
  initialize(_context: PluginContext): void {}
  dispose(): void {}
  async search(_query: string, _options?: SourceOperationOptions): Promise<readonly Song[]> { return []; }
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

`PluginContext.diagnostic()` accepts structured `{ severity, stage, message, error?, detail? }` records; the runtime
adds the Plugin name and isolates callback throws or rejections. Initialization must finish synchronously and must not
return a Promise. Diagnostics must redact credentials, tokens, query strings, and prepared URLs.

`preparePlayback` returns one of two shapes. A streaming source returns a resource: a fresh absolute HTTP(S) `url`
resource acquired immediately before playback, or an `encoded` track for engines that play provider-encoded media. A
metadata-only source returns one trimmed non-empty provider-derived search query instead. Core performs only that
explicit bounded fallback, keeps the original QueueItem public, and owns exactly-once source-resource disposal. The
Player only borrows the resource.

Keep authentication, URL/network policy, retries, metadata mapping, collection ordering, fixtures, and cleanup in the
provider package. Import no private core paths, SDK, testkit, registry, role, manifest, capability graph, cross-plugin
lifecycle hook, or public resource manager. Do not cache prepared URLs or fallback candidates on Song metadata.

An official package may expose a typed provider constructor option. Injected providers are advanced supported seams,
not unvalidated shortcuts: they must honor AbortSignals and lifecycle disposal, return correctly owned Songs and safe
playback outcomes, and pass the same shape, pagination, destination/redirect/body/final-URL, and redaction validation
as the default provider.
