# SourcePlugin authoring

A SourcePlugin is a direct instance with `name`, synchronous `initialize(context)`, `dispose()`, cancellable
`search(query, options?)` and `resolve(url, options?)`, plus required `preparePlayback(song, context)`. Return canonical
`Song` values from public `distube`; core creates QueueItems. Every returned Song must use the exact configured source
name. Return `undefined` only to decline a URL. Once a plugin recognizes a URL or accepts preparation, throw on provider
failure instead of silently falling through.

<!-- verify-ts -->
```ts
import type {
  PlaybackContext,
  PlaybackPreparation,
  PluginContext,
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
  async preparePlayback(song: Song, context: PlaybackContext): Promise<PlaybackPreparation> {
    if (song.source !== this.name || context.signal.aborted) throw new Error("invalid preparation");
    return {
      kind: "resource",
      resource: { kind: "url", url: "https://stream.example/audio", dispose: () => undefined },
    };
  }
}
```

A streaming source returns one fresh absolute HTTP(S) URL resource immediately before playback. A metadata-only
source returns one trimmed non-empty provider-derived search query. Core performs only that explicit bounded fallback,
keeps the original QueueItem public, and owns exactly-once source-resource disposal. The Player only borrows it.

Keep authentication, URL/network policy, retries, metadata mapping, collection ordering, fixtures, and cleanup in the
provider package. Import no private core paths, SDK, testkit, registry, role, manifest, capability graph, cross-plugin
lifecycle hook, or public resource manager. Do not cache prepared URLs or fallback candidates on Song metadata.
