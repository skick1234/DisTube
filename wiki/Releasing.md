# Releasing packages

The repository publishes `distube`, `@distube/discordjs`, `@distube/oceanic`, and `@distube/eris` independently. A release must pass
lint, types, package-local tests, build, cycle checks, API reports, documentation, measured critical coverage, dependency audit,
and clean packed-install smoke tests before publication.

Use global `gitnexus status`/`gitnexus analyze` for graph freshness and Bun/Bunx for every repository command. Use
changesets to select changed packages and preserve dependency order: publish `distube` before an adapter that
requires its new public contract. npm provenance is mandatory. Archives are generated in temporary directories for
verification only; never commit `.tgz` files or `.artifacts/` trees. Plugin and example repositories consume a
recorded packed core fingerprint and rerun their independent gates before their own release.

## Dependency and documentation gates

`dependency-policy.json` freezes the selected manifest ranges, Bun lock format, intentional prereleases, peer
evidence, and warning dispositions. Run `bun run check:dependencies` before release; expired upstream dispositions or
manifest/lock drift fail closed. Regenerate `bun.lock` only with Bun 1.4.2.

The documentation gate builds declarations with TypeScript 7, generates the API model with API Extractor 7.58,
creates the API reference, and builds VitePress 2 alpha without publishing. TypeDoc is not part of the release
toolchain. The generated `docs/`, report, cache, and archive outputs remain untracked.

Adapter peer support is limited to the exact lower/latest matrix in `adapter-compatibility.json`. If a boundary no
longer clean-installs, narrow the peer range with a breaking changeset and migration note before freezing archives.

Package/export/dependency/test inventories come from parsed manifests and source syntax; workflow parity parses YAML
jobs, needs, and steps. The workspace verification DAG records owners, inputs, outputs, commands, and fingerprints,
but each repository's `bun run verify` remains independently runnable. A changed upstream commit, declaration,
archive, peer range, export map, or lock invalidates only its transitive consumers.

Freeze and candidate generators derive current package names and versions, emit dated evidence, and default
publication authorization to false. Never edit candidate evidence in place: regenerate it after any input change, then
obtain separate authorization naming that exact fingerprint before any publish, push, tag, release, or docs deploy.
