# Releasing packages

The repository publishes `distube`, `@distube/discordjs` and `@distube/oceanic` independently.
The only gate is `bun run verify`: oxlint and oxfmt (including the import-boundary and import-cycle rules), `tsrs --noEmit`,
vitest with coverage and the package builds. CI runs exactly that command on every push and pull request to `main`
and on every release tag. There is no freeze, fingerprint or release-candidate step.

## Steps

1. Merge the changesets for the release into `main` and run `bun run version-packages` (`changeset version`) on a
   branch. Publish `distube` before an adapter that depends on its new public contract.
2. Merge the version bump. The tagged commit must be green on the `Test` workflow.
3. Push one tag per package, named `<package>@<version>`, for example `distube@6.0.0` or
   `@distube/discordjs@6.0.0`.
4. The `Publish` workflow checks the tag against the package manifest, runs `bun run verify`, runs `npm pack` in the
   package directory and publishes the archive with `npm publish --provenance`. npm authenticates the job through
   trusted publishing (GitHub OIDC); no npm token exists in CI. The CI run on the tagged commit is the release evidence.

## New packages

npm accepts a trusted publisher only for a package that already exists. Before a new package's first tag:

1. Publish a `0.0.0` placeholder, a `package.json` and a README, by hand with 2FA: `npm publish --access public`.
2. Within two days before the first tag, run
   `npm trust github <package> --repo skick1234/DisTube --file publish.yml --allow-publish`.
   A config that sees no successful publish within two days expires.
3. After the first CI publish, set the package's publishing access to "Require two-factor authentication and
   disallow tokens".

Apart from that placeholder, never run `npm publish` locally, and never commit `.tgz` files. The plugin and example repositories consume core
through `file:../DisTube/packages/<pkg>` links and run their own `verify` against the core `main` branch.

## Dependency and documentation gates

`bun install --frozen-lockfile` fails on manifest or lock drift. Regenerate `bun.lock` only with Bun 1.4.3.

Narrow an adapter peer range with a breaking changeset and migration note before tagging.

## Documentation

After `publish` succeeds, the `docs` job of the `Publish` workflow checks out `distubejs/distubejs.github.io` with the
`DOCS_DEPLOY_KEY` deploy key and runs `site/scripts/snapshot.ts` for the tagged package. It commits the snapshot as the
tag name and pushes to the site's `main`, rebasing and retrying up to three times. The site's own workflow then deploys
https://distube.js.org. Tags whose version contains `-` skip the job. Guides for `distube` and the plugins live in
`docs/`.
