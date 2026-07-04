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
```

All four are what CI runs on every push to `main` and pull request.

### Where things live

```
packages/argon2/     Argon2d/Argon2id KDF — see its README.md and SPEC.md
packages/chacha20/   ChaCha20/Salsa20 stream ciphers — see its README.md and SPEC.md
packages/kdbx/       KDBX 3.1/4.x parser and serializer — see its README.md and SPEC.md
pages/               the browser app — index, router, and the KDBX 0x67 app itself
tools/build/         the bundler and inliner that assemble pages/ into a single HTML file
docs/                this document, plus the pipeline, release, and reproducibility docs
```

Each package under `packages/` is a separate npm workspace with its own `build`/`typecheck`/`test` scripts; the root scripts above run across all of them.

### Test coverage

Every workspace's `test` script runs with `node:test`'s built-in coverage (`--experimental-test-coverage`) and fails the run if line, branch, or function coverage falls short of 100% (`--test-coverage-lines=100 --test-coverage-branches=100 --test-coverage-functions=100`) — matching the 100%-coverage bar in [AGENTS.md][agents]. `npm test` failing on a coverage shortfall is expected, not a bug in the tooling.

One thing to know about how this works: node:test's coverage only reports on files V8 actually loads during the run. A source file with zero tests doesn't show up as 0% — it doesn't show up at all, so the percentage is computed only over what *is* loaded, and a completely untested file can't fail the threshold. Every workspace with source files therefore has a `tests/coverage.test.ts` that imports every file under `src/` (or the package's other module directories) for exactly this reason: once a file is loaded, its untested lines/branches/functions are visible and do fail the threshold like anywhere else.

Two kinds of files can't be handled by that blanket import, and are excluded on purpose rather than silently:

- **CLI entry points** (`tools/build/inliner/src/index.ts`, `tools/build/bundle-iife/src/index.ts`) call `process.exit()` at module scope on the no-args path. Unlike a thrown exception, `process.exit()` can't be caught, so force-importing them would kill the whole test run. They're run as subprocesses instead (see each tool's `tests/*.test.ts`); node:test's coverage collector picks up subprocess coverage automatically via `NODE_V8_COVERAGE`, so this still counts them.
- **`pages/0x67/page.ts`** calls real DOM APIs at module scope and is left to throw when force-imported under plain Node (no DOM available) — see `pages/tests/coverage.test.ts`. The throw is expected and intentional: V8 still records coverage for whatever ran before it, so the file shows up in the report at its real, low percentage instead of vanishing. Actually testing it needs a DOM implementation for tests (e.g. jsdom/happy-dom), which isn't set up yet — a real decision for the team, not something routed around here. Its DOM-free logic (entry/group lookups and tree traversal) lives separately in `pages/0x67/logic.ts` instead, specifically so it isn't caught in this exclusion — see `pages/tests/0x67-logic.test.ts` for real, passing unit tests of that slice, and `pages/0x67/globals.d.ts`/`bundle-iife.json` for how page.ts still consumes it as a global in the shipped bundle (bundled together with the kdbx library, both feeding the same `deps.js`).
- **`tools/build/ruleset/check.js`** is excluded from `tools/build`'s coverage entirely (not in its `--test-coverage-include` globs): it's a live script that calls the GitHub API and `process.exit()`, not a pure module, so it isn't safely importable either, and it currently has no automated tests at all.

### Branch protection

Pull requests are required on `main`; direct pushes are blocked. See [Branch protection rulesets][rulesets] for the exact requirements.

## Sponsoring

This project runs on an open-core model: the core app is MIT-licensed and always free, and [GitHub Sponsors][sponsors] funds development and security audits and unlocks the hosted cloud-storage features. See [Licensing][licensing] for how that works.

[issues]: https://github.com/keepass-web/source-application/issues
[discussions]: https://github.com/keepass-web/source-application/discussions
[security]: https://github.com/keepass-web/.github/blob/main/profile/FAQ.md
[rulesets]: RULESETS.md
[sponsors]: https://github.com/sponsors/keepass-web
[licensing]: https://github.com/keepass-web/.github/blob/main/profile/LICENSING.md
[agents]: ../AGENTS.md
