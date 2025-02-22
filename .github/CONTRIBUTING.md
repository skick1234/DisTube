# Contributing to DisTube

Thank you for your interest in contributing to DisTube! This document provides guidelines and instructions for contributing to the project.

## 📝 Issues

- The issue tracker is for bug reports only.
- For questions or feature suggestions, please use our [Discord Support Server](https://discord.gg/feaDd9h).
- Before creating an issue, please check the [FAQ](https://github.com/skick1234/DisTube/wiki/Frequently-Asked-Questions) and existing issues (both open and closed).

## 🛠️ Pull Requests

We welcome contributions via pull requests! Please follow these guidelines:

1.  **Fork the repository** and create a new branch from `main` for your changes:

    ```bash
    git checkout -b feature/your-feature-name
    ```

2.  **Install dependencies:**

    ```bash
    npm ci
    ```

3.  **Make your changes**, ensuring they align with the project's goals and coding style.

4.  **Run checks:** Before submitting, ensure your code passes the following checks:

    ```bash
    npm run prettier   # Format code
    npm run lint      # Check for linting errors
    npm run build:check # Ensure the project compiles
    npm run test      # Run tests
    ```

5.  **Commit your changes** using the [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) format:

    ```bash
    git commit -m "feat: add new feature"
    ```

6.  **Create a pull request:** Push your branch to your fork and open a pull request against the `main` branch of the DisTube repository.

### Pull Request Guidelines

- Keep pull requests focused on a single issue or feature.
- Include relevant tests for your changes.
- Update documentation (if applicable).
- Follow the project's existing code style.
- Ensure all tests pass before submitting.
- Link any related issues in the pull request description.

## ⚙️ Development Setup

DisTube is built with TypeScript and uses the following tools:

- [pnpm](https://pnpm.io/): Package manager (though npm is also supported)
- [Prettier](https://prettier.io/): Code formatter
- [ESLint](https://eslint.org/): Linter
- [Vitest](https://vitest.dev/): Test runner
- [TypeDoc](https://typedoc.org/): Documentation generator

## ⚖️ License

By contributing to DisTube, you agree that your contributions will be licensed under the [MIT License](LICENSE).

## ❓ Support

If you have any questions or need help, please join our [Discord Support Server](https://discord.gg/feaDd9h).
