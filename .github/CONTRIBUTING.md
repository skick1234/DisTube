# Contributing to DisTube

Thank you for your interest in contributing to DisTube! This document provides guidelines and instructions for contributing to the project.

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## 📝 Issues

We use GitHub Issues to track bugs and feature requests.

- **Bug Reports**: Please use the [Bug Report](https://github.com/skick1234/DisTube/issues/new?template=bug_report.yml) form. Provide a minimal reproduction code sample.
- **Feature Requests**: Please use the [Feature Request](https://github.com/skick1234/DisTube/issues/new?template=feature_request.yml) form.
- **Questions**: For questions or general support, please join our [Discord Support Server](https://discord.gg/feaDd9h) or check the [FAQ](https://github.com/skick1234/DisTube/wiki/Frequently-Asked-Questions).

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

    Use the globally installed `gitnexus status` and `gitnexus analyze` commands for graph freshness. Run tooling with
    Bun/Bunx; do not invoke project tools through Node, npm, or npx command runners.

5.  **Commit your changes** using [Conventional Commits](https://www.conventionalcommits.org/):
    ```bash
    git commit -m "feat(Queue): add shuffle method"
    git commit -m "fix(Voice): handle reconnection error"
    ```

6.  **Open a Pull Request** against the `main` branch. A template will be provided to help you describe your changes.

## ⚙️ Development Environment

- **Runtime**: Node.js >= 22.12.0
- **Package Manager**: Bun 1.4.0 (the version pinned by the repository toolchain)
- **Linter/Formatter**: [Biome](https://biomejs.dev/)

## 📂 Directory Structure

The codebase is organized by durable ownership:

- `packages/distube/`: public client, queue/player/plugin contracts, runtime behavior, and package-local tests.
- `packages/discordjs/`: direct discord.js Adapter and Player with package-local tests.
- `packages/oceanic/`: direct Oceanic Adapter and Player with package-local tests.
- `packages/eris/`: direct Eris Adapter and Player with package-local tests.
- `scripts/`: architecture, API, documentation, package, structural inventory, audit, and critical-coverage release gates.

### Scripts
- `bun run build`: Build all four packages once and record fingerprinted prepared output
- `bun run test`: Run the fast coverage-disabled unit tests
- `bun run test:release`: Run the sole fail-closed coverage-enabled release test pass
- `bun run check:circular`: Check for circular dependencies
- `bun run check:write`: Fix linting/formatting issues
- `bun run docs`: Generate the API Extractor model and build the VitePress documentation site
- `bun run check:critical-quality`: Verify complete production-source coverage scopes and package-class floors without rerunning tests
- `bun run check:packages:prepared`: Verify packed imports from the current fingerprinted build; the unsuffixed command prepares stale output
- `bun run verify`: Run the complete non-publishing repository gate, including structural workflow parity

## Dependency modernization

Dependency changes begin with a dated registry inventory. Stable releases are selected by default; an intentional
prerelease such as VitePress 2 alpha must be named in `dependency-policy.json` with focused build evidence. Update
dependencies in risk groups (tooling, core, adapters), regenerate `bun.lock` only with the pinned Bun release, and
run `bun run check:dependencies` after every group.

Project-actionable deprecation warnings must be migrated. An upstream-only warning requires evidence, an owner, risk,
and a dated recheck condition; false positives require proof. Peer ranges are support contracts and must match the
lower/latest cases in `adapter-compatibility.json` rather than being mechanically pinned to one release.

For cross-repository work, verify and pack `distube` plus adapters first, record archive hashes, verify and pack media
plugins against that core archive, then install all fingerprinted archives in the example. Never publish or commit
the temporary archives.

Workspace orchestration derives package, export, dependency, and test inventories from manifests and syntax. Its
fingerprinted dependency DAG invalidates only downstream consumers when an input changes; it never becomes a hidden
prerequisite for this repository's `verify` command. Any changed commit, declaration, archive, peer range, or lock
invalidates the affected candidate evidence and resets publication authorization to false.

## ⚖️ License

By contributing to DisTube, you agree that your contributions will be licensed under the [MIT License](../LICENSE).
