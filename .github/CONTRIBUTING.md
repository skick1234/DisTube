# Contributing to DisTube

Thank you for your interest in contributing to DisTube! This document provides guidelines and instructions for contributing to the project.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## 📝 Issues

We use GitHub Issues to track bugs and feature requests.

- **Bug Reports**: Please use the [Bug Report](https://github.com/skick1234/DisTube/issues/new?template=bug_report.yml) form. Provide a minimal reproduction code sample.
- **Feature Requests**: Please use the [Feature Request](https://github.com/skick1234/DisTube/issues/new?template=feature_request.yml) form.
- **Questions**: For questions or general support, please join our [Discord Support Server](https://discord.gg/feaDd9h) or check the [FAQ](https://distube.js.org/distube/guides/faq/).

**Please do not report security vulnerabilities in public issues.** See [SECURITY.md](SECURITY.md) for more details.

## 🛠️ Pull Requests

We welcome contributions via pull requests!

1.  **Fork the repository** and create a new branch from `main`:

    ```bash
    git checkout -b feature/your-feature-name
    ```

2.  **Install dependencies** using [bun](https://bun.sh/):

    ```bash
    bun install
    ```

3.  **Make your changes** in the owning package or runtime domain.

4.  **Verify your changes**:

    ```bash
    bun run verify
    ```

    Run tooling with Bun/Bunx; do not invoke project tools through Node, npm, or npx command runners.

5.  **Commit your changes** using [Conventional Commits](https://www.conventionalcommits.org/):

    ```bash
    git commit -m "feat(Queue): add shuffle method"
    git commit -m "fix(Voice): handle reconnection error"
    ```

6.  **Open a Pull Request** against the `main` branch. A template will be provided to help you describe your changes.

## ⚙️ Development Environment

- **Runtime**: Node.js >= 22.12.0
- **Package Manager**: Bun 1.4.4 (the version pinned by the repository toolchain)
- **Linter/Formatter**: [oxlint](https://oxc.rs/docs/guide/usage/linter) and [oxfmt](https://oxc.rs/docs/guide/usage/formatter)

## 📂 Directory Structure

The codebase is organized by durable ownership:

- `packages/distube/`: public client, queue/player/plugin contracts, runtime behavior, and package-local tests.
- `packages/discordjs/`: direct discord.js Adapter and Player with package-local tests.
- `packages/oceanic/`: direct Oceanic Adapter and Player with package-local tests.
- `scripts/`: adapter build sanitizer and documentation generator.

### Scripts

- `bun run check`: oxlint and oxfmt, including the core import boundary and import-cycle rules
- `bun run type`: `tsrs --noEmit` in every package
- `bun run test`: Run the fast coverage-disabled unit tests
- `bun run test:release`: Run the coverage-enabled test pass
- `bun run build`: Build all three packages
- `bun run docs`: Build, run API Extractor and build the VitePress documentation site
- `bun run verify`: Run the whole gate above in order (no `docs`); CI runs exactly this

## Dependencies

Update dependencies in groups (tooling, core, adapters) and regenerate `bun.lock` only with the pinned Bun release.
CI installs with `--frozen-lockfile`, so manifest or lock drift fails.

## Releasing

See [RELEASING.md](RELEASING.md). In short: commit `chore(Release): <package>@<version>` with only that version
bump, then push the `<package>@<version>` tag on it; CI checks the commit, verifies, `npm pack`s that package,
publishes it with provenance through npm trusted publishing and creates the GitHub release. Do not change a version
in any other commit.

## ⚖️ License

By contributing to DisTube, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
