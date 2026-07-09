# KeePass Web

A password manager that reads and writes [KDBX][kdbx] database files entirely in your browser. A single purpose HTML files, no native application install, no web server, and no network: just your KeePass database file viewed and edited in your browser tab's memory. This repo is the source for the whole thing: the crypto primitives, the KDBX parser, the browser app, and the tooling that builds it into a distributable HTML files. No external dependencies are used.

## Contents

```
packages/     argon2, chacha20, kdbx: the cryptographic and file-format building blocks
pages/        the browser app itself (what actually ships)
tools/build/  the bundler and inliner that produce the distributables
```

## Using it

- **Local:** download the latest files from [Releases][gh-releases] and open `index.html` in any modern browser. Follow the links. Upload your KeePass database file and go.
- **Online:** visit [keepass-web.app][app] — the exact same file, served by GitHub Pages, so you can run it without downloading first (handy on a machine that isn't yours). Every feature is identical to the download, the cloud-storage connectors included.

Refer to [Reproducing a build][reproducing] to verify for yourself how these files are built.

## Trust

The whole point of shipping as a single, un-minified HTML file is that you don't have to take our word for anything. Read the source, watch the network tab, verify the release checksum. The design philosophy behind that approach and the org's overall rationale is written up in the [org level][philosophy]. For how this repo's own pipeline enforces it, see [Pipeline][pipeline] and [Releases][releases].

## Contributing

See [Contributing][contributing] for how to report a bug, propose a change, and build/test/lint locally. See each package's own `README.md`/`SPEC.md` (`packages/argon2`, `packages/chacha20`, `packages/kdbx`) for the algorithms implemented and why.

This project is MIT-licensed and entirely free — including the connectors that open your database from your own cloud storage provider — and open to everyone with no sponsorship gate. We don't provide storage; you connect to a provider you already have. [GitHub Sponsors][sponsors] funds ongoing development and security audits; it is an invitation, never a paywall. See [Licensing][licensing] for how that works.

## License

[MIT][license]

[kdbx]: https://keepass.info/help/kb/kdbx.html
[app]: https://keepass-web.app/
[gh-releases]: https://github.com/keepass-web/source-application/releases
[webcrypto]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API
[releases]: docs/RELEASES.md
[reproducing]: docs/REPRODUCING.md
[philosophy]: https://github.com/keepass-web/.github/blob/main/profile/PHILOSOPHY.md
[pipeline]: docs/PIPELINE.md
[contributing]: docs/CONTRIBUTING.md
[sponsors]: https://github.com/sponsors/keepass-web
[licensing]: https://github.com/keepass-web/.github/blob/main/profile/LICENSING.md
[license]: LICENSE
