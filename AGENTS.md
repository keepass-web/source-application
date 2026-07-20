# Agent instructions

This repo builds a password manager. Any code an agent writes here — a one-line fix or a large refactor — must be in complete agreement with the philosophy, approach, user-mindfulness, conventions, and quality requirements below. When a request seems to conflict with any of them, say so and ask, rather than quietly picking a side.

## Philosophy

The org-level [philosophy and rationale][philosophy] is the authoritative statement of intent; this section exists so an agent doesn't have to fetch it to get the gist. In short: minimalism (ship as self-contained HTML distributables; no frameworks; only WebCrypto as a runtime dependency), impeccability (100% test coverage, enforced lint with no exceptions, no long-lived open issues), and trustworthiness (open source, auditable, independently verified).

The concrete implication for an agent: don't reach for a framework, a general-purpose library, or a build step where hand-written, fully-owned code would do. If it isn't obvious why a piece of complexity exists, it probably shouldn't.

## Priorities

When a design decision has more than one reasonable answer, resolve it in this order: correct operation, minimal surface area (to-the-point comments, efficient algorithms, no excess features), readable (plain language, clear names), explicit (the user does something deliberate to kick off a behavior — nothing fires as a side effect), convenient, performant. Higher wins. Don't trade a higher priority for a lower one to make a later item nicer — for example, don't add a persisted session to make something more convenient at the cost of making it less explicit, and don't reach for a shared abstraction at the cost of a larger, harder-to-audit surface area.

## Approach

Every internal dependency is owned, not borrowed. `packages/argon2`, `packages/chacha20`, and `packages/kdbx` are consumed by relative import to each other's compiled output in `build/packages/` — never through a `dependencies` entry in any `package.json`, and never published. `grep -r '"dependencies"' --include=package.json .` should always come back empty for internal code; if a change makes it not empty, that change is wrong.

Builds are reproducible and every build-time dependency is pinned to an exact, integrity-verified version — see [Reproducing a build][reproducing]. Don't introduce a floating version (`^`, `~`, `latest`) for anything that produces the shipped output.

No runtime dependencies. devDependencies allowed case by case; none with an install script. Full policy: [Dependency policy][contributing-deps].

## User-mindfulness

This app handles other people's passwords. Before making a change, ask: does this add a network call, telemetry, or any other way for data to leave the browser? The entire trust model rests on a user being able to watch the network tab and see nothing on the app (`0x67.html`) and every offline page — that must stay true without exception. The cloud connectors are the one place network traffic is expected, and even there the rule is narrow: a connector may load only the SDK of the provider the user just chose to sign in to (e.g. Google's Picker), never code from an unrelated third party, and the master password and all decryption stay in the embedded `0x67.html` iframe, which loads no external code. Don't widen that boundary — no external script on an offline page, no third-party code in a connector — without it being an explicit, deliberate, documented decision, never a side effect.

Keep code readable by a literate technical user in a single sitting. Prefer the obvious approach over the clever one. Never log, transmit, or persist a password, secret, or decrypted field anywhere outside in-memory browser state.

## Conventions

- Markdown links are always [reference-link style][gfm-reflinks] — `[text][key]` with definitions collected at the bottom of the file — never inline `[text](url)`.
- Markdown files are written without hard breaks or line wraps.
- Repo layout: `packages/<name>/` holds a library's source, tests, `README.md`, and `SPEC.md` together; `pages/` is the browser app; `tools/build/` is the build tooling; `docs/` holds process and reference documentation that isn't specific to one package or page — it does not duplicate org-level docs, and it does not hold per-package or per-page READMEs.
- Names describe function, not just identity (`pages/`, not `app/`; `source-application` describes what the repo contains). Connector pages under `pages/` follow `cloud-{vendor}-{brand}.html`, falling back to `storage` as the brand when a vendor has no separately-named product — see [Pages][pages].
- Source, build, and dist never overlap. Source directories hold only hand-authored code. `build/` (top-level, mirroring `packages/` and `pages/` — e.g. `build/packages/kdbx/`, `build/pages/0x67/`) holds intermediate, always-regenerated compiler and bundler output. `dist/` (top-level) holds the final distributables. Neither `build/` nor `dist/` is ever committed; deleting either never loses anything that can't be regenerated by `npm run build`.
- One version number, at the repo root. Packages under `packages/` don't carry independent versions — they aren't published.
- Biome lint and format are enforced with no exceptions. `npm run lint` must be clean before a change is done.

## Quality requirements

Before considering any change complete, all five must pass — this is exactly what CI runs, in this order:

```sh
npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e --workspace=e2e
```

The first four run against source and jsdom; the last is real-browser coverage jsdom can't provide (no layout engine) — it drives the actual built `dist/*.html` in Chrome, not source, so it needs `npm run build` to have just run first. It's easy to forget because it isn't part of `npm test`, but a change can pass every unit test and still fail here — e.g. a DOM class or selector that a jsdom test and the real page happen to agree on today but that a later change breaks in only one of them. Always run it, not just when files under `e2e/` change.

New logic needs tests; the project's standing bar is 100% coverage, not "we'll add tests later." Don't silently fix unrelated pre-existing issues inside an unrelated change — note them instead, so diffs stay auditable — but do fix anything the change itself breaks. Prefer the smallest correct change, and check before touching release/deploy credentials, branch protection rulesets, or anything published or externally reachable.

New UI surface must work at phone width, not just desktop — this app has no separate mobile build, so `pages/0x67/page.css` is solely responsible for that. Resize to a narrow viewport (e.g. ~375px) and check any new screen or control before considering it done, the same way a change isn't done until its tests pass. Extend the existing `@media (max-width: 700px)` rules (collapsible sidebar drawer, wrapped header, panel overflow menu) rather than inventing a parallel pattern.

## See also

- [Contributing][contributing] — how to propose a change and the local dev loop
- [Releases][releases] — what a release produces and how it ships
- [Pipeline][pipeline] — the full CI/release/deploy picture
- [Pages][pages] — what each page does and how a visitor moves between them
- [Reproducing a build][reproducing] — verifying a distributable independently
- [Branch protection rulesets][rulesets] — what every repo in the org requires
- [Licensing][licensing] — the open-core model

[philosophy]: https://github.com/keepass-web/.github/blob/main/profile/PHILOSOPHY.md
[reproducing]: docs/REPRODUCING.md
[gfm-reflinks]: https://github.github.com/gfm/#reference-link
[contributing]: docs/CONTRIBUTING.md
[contributing-deps]: docs/CONTRIBUTING.md#dependency-policy
[releases]: docs/RELEASES.md
[pipeline]: docs/PIPELINE.md
[pages]: docs/PAGES.md
[rulesets]: docs/RULESETS.md
[licensing]: https://github.com/keepass-web/.github/blob/main/profile/LICENSING.md
