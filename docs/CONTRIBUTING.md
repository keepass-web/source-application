# Contributing

## Reporting bugs and proposing changes

For bugs, [open an issue][issues]. For questions, ideas, or anything not yet a concrete bug, [start a discussion][discussions] first — especially before a large change, so the approach can be agreed on before code gets written.

Found a security vulnerability? Do not open a public issue. See the org's [security policy][security] for the reporting address.

## Developing locally

```sh
git clone git@github.com:keepass-web/source-application.git
cd source-application
npm install
npm ci
```

Then, before opening a pull request:

```sh
npm run lint        # Biome, formatting and style
npm run typecheck   # tsc --noEmit, across every package
npm test            # every package's test suite
npm run build       # produces dist/*.html, the same distributables a release ships
npm run test:e2e --workspace=e2e   # real-browser tests against the dist/*.html just built
```

All five are what CI runs on every push to `main` and pull request.

### Where things live

```
packages/argon2/     Argon2d/Argon2id KDF — see its README.md and SPEC.md
packages/chacha20/   ChaCha20/Salsa20 stream ciphers — see its README.md and SPEC.md
packages/kdbx/       KDBX 3.1/4.x parser and serializer — see its README.md and SPEC.md
pages/               the browser app — index, router, and the KDBX 0x67 app itself
tools/build/         the bundler and inliner that assemble each page into its own self-contained distributable, plus the ruleset and dependency policy CI checks
docs/                this document, plus the pipeline, release, and reproducibility docs
```

Each package under `packages/` is a separate npm workspace with its own `build`/`typecheck`/`test` scripts; the root scripts above run across all of them.

### Test coverage

Every workspace's `test` script runs with `node:test`'s built-in coverage (`--experimental-test-coverage`) and fails the run if line, branch, or function coverage falls short of 100% (`--test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100`) — matching the 100%-coverage bar in [AGENTS.md][agents]. `npm test` failing on a coverage shortfall is expected, not a bug in the tooling.

node:test only reports coverage for files it actually loads, so an untested file doesn't show up as 0% — it doesn't show up at all. Every workspace's `tests/coverage.test.ts` force-imports every source file to close that hole.

Exceptions:

- **CLI entry points** (`tools/build/inliner/src/index.ts`, `tools/build/bundle-iife/src/index.ts`) call `process.exit()` at module scope, so they're run as subprocesses instead (see each tool's `tests/*.test.ts`); coverage is picked up via `NODE_V8_COVERAGE`.
- **`tools/build/ruleset/check.js`** is excluded from `tools/build`'s `--test-coverage-include` globs entirely and has no automated tests: it is a thin wrapper over live `gh`/GitHub API calls with no DOM-free logic worth isolating, can't be exercised without mocking the whole API surface, and fails closed (any absent, disabled, or misconfigured rule exits non-zero and blocks the pipeline). It is validated by running against real repositories in CI, not by unit tests.
- **`pages/0x67/page.ts`** is DOM-dependent. `pages/tests/0x67-page.test.ts` covers it with `jsdom`; `pages/tests/coverage.test.ts` still force-imports it too (throws immediately under plain Node, harmless). Its DOM-free logic lives in `pages/0x67/logic.ts`, tested directly in `pages/tests/0x67-logic.test.ts`.

### Dependency policy

Runtime dependencies: never added. devDependencies: allowed, case by case. No devDependency may have an install script. `node tools/build/dependency-policy/check.js` checks `package-lock.json` for `hasInstallScript` and fails the build if any are found. No allow-list.

### Branch protection

Pull requests are required on `main`; direct pushes are blocked. See [Branch protection rulesets][rulesets] for the exact requirements.

## Sponsoring

This project is MIT-licensed and entirely free — every feature, including the connectors to your own cloud storage provider, is open to everyone with no sponsorship gate. We don't provide storage; you connect to a provider you already have. [GitHub Sponsors][sponsors] funds development and security audits; it is a voluntary invitation, never a paywall. See [Licensing][licensing] for how that works.

[issues]: https://github.com/keepass-web/source-application/issues
[discussions]: https://github.com/keepass-web/source-application/discussions
[security]: https://github.com/keepass-web/.github/blob/main/profile/FAQ.md
[rulesets]: RULESETS.md
[sponsors]: https://github.com/sponsors/keepass-web
[licensing]: https://github.com/keepass-web/.github/blob/main/profile/LICENSING.md
[agents]: ../AGENTS.md
