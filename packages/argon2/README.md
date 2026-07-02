# argon2

Argon2d and Argon2id key derivation function implementation for the [keepass-web][org] project.

Note: only the Argon2id and Argon2d variants are supported, because that's all that's required for KeePass. Argon2i is not implemented, consistent with RFC 9106, which requires only Argon2id.

## Specification

See [SPEC.md][spec].

## Usage

Not published — this package isn't consumed through the npm registry at all. It's imported by relative path from its built `dist/` output, currently by `packages/kdbx` (see `kdf.ts`). If you want to use it outside this repo, copy the package or import its `src/` directly; there's nothing else it depends on.

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

[org]: https://github.com/keepass-web
[spec]: ./SPEC.md
