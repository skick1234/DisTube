# Releasing packages

The repository publishes `distube`, `@distube/discordjs`, `@distube/oceanic` and `@distube/eris` independently.
The only gate is `bun run verify`: Biome (including the import-boundary and import-cycle rules), `tsc --noEmit`,
vitest with coverage and the package builds. CI runs exactly that command on every push and pull request to `main`
and on every release tag. There is no freeze, fingerprint or release-candidate step.

## Steps

1. Merge the changesets for the release into `main` and run `bun run version-packages` (`changeset version`) on a
   branch. Publish `distube` before an adapter that depends on its new public contract.
2. Merge the version bump. The tagged commit must be green on the `Test` workflow.
3. Push one tag per package, named `<package>@<version>`, for example `distube@6.0.0` or
   `@distube/discordjs@6.0.0`.
4. The `Publish` workflow checks the tag against the package manifest, runs `bun run verify`, runs `npm pack` in the
   package directory and publishes the archive with `npm publish --provenance`. The CI run on the tagged commit is
   the release evidence.

Never run `npm publish` locally and never commit `.tgz` files. The plugin and example repositories consume core
through `file:../DisTube/packages/<pkg>` links and run their own `verify` against the core `main` branch.

## Dependency and documentation gates

`bun install --frozen-lockfile` fails on manifest or lock drift. Regenerate `bun.lock` only with Bun 1.4.3.

`bun run docs` builds the packages, generates the API model with API Extractor and builds the VitePress site; the
`Documentation Generator` workflow deploys it from `main`. Narrow an adapter peer range with a breaking changeset and migration note before tagging.
