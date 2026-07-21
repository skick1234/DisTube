# Releasing packages

The repository publishes `distube`, `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris` independently. A release must pass
lint, types, package-local tests, build, cycle checks, API reports, documentation, mutation checks, dependency audit,
and clean packed-install smoke tests before publication.

Use changesets to select changed packages and preserve dependency order: publish `distube` before an adapter that
requires its new public contract. npm provenance is mandatory. Archives are generated in temporary directories for
verification only; never commit `.tgz` files or `.artifacts/` trees. Plugin and example repositories consume a
recorded packed core fingerprint and rerun their independent gates before their own release.

## Dependency and documentation gates

`dependency-policy.json` freezes the selected manifest ranges, Bun lock format, intentional prereleases, peer
evidence, and warning dispositions. Run `bun run check:dependencies` before release; expired upstream dispositions or
manifest/lock drift fail closed. Regenerate `bun.lock` only with Bun 1.3.14.

The documentation gate builds declarations with TypeScript 7, generates the API model with API Extractor 7.58,
creates the API reference, and builds VitePress 2 alpha without publishing. TypeDoc is not part of the release
toolchain. The generated `docs/`, report, cache, and archive outputs remain untracked.

Adapter peer support is limited to the exact lower/latest matrix in `adapter-compatibility.json`. If a boundary no
longer clean-installs, narrow the peer range with a breaking changeset and migration note before freezing archives.

The rewrite's first stable release is exactly v6. Generate and inspect `changeset status` before versioning: all four
packages must resolve from `6.0.0-dev.0` to `6.0.0`, never v7. Run `bun run verify` before publication; its workflow
parity gate proves the pinned Bun 1.3.14 CI jobs execute the same non-publishing repository checks first.
