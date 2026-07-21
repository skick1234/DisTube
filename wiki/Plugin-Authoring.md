# SourcePlugin authoring

A SourcePlugin is a direct instance with `name`, synchronous `initialize(context)`, `dispose()`, `search(query)`, and
`resolve(url)`. Return canonical `Song` values from public `distube`; core creates QueueItems. Return `undefined` only
to decline a URL. Once a plugin recognizes a URL, throw on provider failure instead of silently falling through.

Keep authentication, URL/network policy, retries, metadata mapping, collection ordering, fixtures, and cleanup in the
provider package. Import no private core paths, SDK, testkit, registry, role, manifest, or capability graph.
