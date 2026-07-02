# Contributing

## Reporting bugs and proposing changes

For bugs, [open an issue][issues]. For questions, ideas, or anything not yet a concrete bug, [start a discussion][discussions] first — especially before a large change, so the approach can be agreed on before code gets written.

Found a security vulnerability? Do not open a public issue. See the org's [security policy][security] for the reporting address.

## Developing locally

```sh
git clone git@github.com:keepass-web/source-application.git
cd source-application
npm ci
```

Then, before opening a pull request:

```sh
npm run lint        # Biome, formatting and style
npm run typecheck    # tsc --noEmit, across every package
npm test             # every package's test suite
npm run build         # produces dist/*.html, the same distributables a release ships
```

All four are what CI runs on every push and pull request; running them locally first saves a round trip.

### Where things live

```
packages/argon2/   Argon2d/Argon2id KDF — see its README.md and SPEC.md
packages/chacha20/ ChaCha20/Salsa20 stream ciphers — see its README.md and SPEC.md
packages/kdbx/     KDBX 3.1/4.x parser and serializer — see its README.md and SPEC.md
pages/             the browser app — index, router, and the KDBX 0x67 app itself
tools/build/       the bundler and inliner that assemble pages/ into a single HTML file
docs/              this document, plus the pipeline, release, and reproducibility docs
```

Each package under `packages/` is a separate npm workspace with its own `build`/`typecheck`/`test` scripts; the root scripts above run across all of them.

### Branch protection

Pull requests are required on `main`; direct pushes are blocked. See [Branch protection rulesets][rulesets] if you're setting up a new repository under the org and need to reproduce this.

## Sponsoring

This project runs on an open-core model: the core app is MIT-licensed and always free, and [GitHub Sponsors][sponsors] funds development and security audits and unlocks the hosted cloud-storage features. See [Licensing][licensing] for how that works.

[issues]: https://github.com/keepass-web/source-application/issues
[discussions]: https://github.com/keepass-web/source-application/discussions
[security]: https://github.com/keepass-web/.github/blob/main/profile/FAQ.md
[rulesets]: RULESETS.md
[sponsors]: https://github.com/sponsors/keepass-web
[licensing]: https://github.com/keepass-web/.github/blob/main/profile/LICENSING.md
