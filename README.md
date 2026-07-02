# KeePass Web

A password manager that reads and writes [KDBX][kdbx] database files entirely in your browser — no install, no server, no account. This repo is the source for the whole thing: the crypto primitives, the KDBX parser, the browser app, and the tooling that builds it into a single distributable HTML file.

```
packages/   argon2, chacha20, kdbx — the cryptographic and file-format building blocks
pages/      the browser app itself (what actually ships)
tools/build/  the bundler and inliner that produce the single-file distributable
```

## Using it

- **Online:** [keepass-web.app][app]
- **Local:** download the latest `keepass-web-0x67.html` from [Releases][gh-releases] and open it in any browser with [WebCrypto][webcrypto] support. Nothing to install; nothing leaves your machine.

Both are the same file, byte for byte — see [Releases][releases] for what each distributable is and [Reproducing a build][reproducing] to verify that yourself.

## Trust

The whole point of shipping as a single, un-minified HTML file is that you don't have to take our word for anything. Read the source, watch the network tab, verify the release checksum. The design philosophy behind that approach — and the org's overall rationale — is written up at the [org level][philosophy], not duplicated here. For how this repo's own pipeline enforces it, see [Pipeline][pipeline] and [Releases][releases].

## Contributing

See [Contributing][contributing] for how to report a bug, propose a change, and build/test/lint locally. See each package's own `README.md`/`SPEC.md` (`packages/argon2`, `packages/chacha20`, `packages/kdbx`) for the algorithms implemented and why.

This project runs on an open-core model — the core app is MIT-licensed and always free; [GitHub Sponsors][sponsors] funds development and security audits and unlocks the hosted cloud-storage features. See [Licensing][licensing] for how that works.

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
