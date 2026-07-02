# chacha20

ChaCha20 and Salsa20 stream cipher implementation for the [keepass-web][org] project.

This package implements the raw stream ciphers only:
- ChaCha20 (RFC 8439 IETF variant: 256-bit key, 96-bit nonce, 32-bit counter), used by KDBX 4.
- Salsa20 (Bernstein: 256-bit key, 64-bit nonce, 64-bit counter), used by the KDBX 3.1 inner random stream.

Poly1305 and the ChaCha20-Poly1305 AEAD construction from RFC 8439 are not implemented, because they are not needed for KDBX.

## Specification

See [SPEC.md][spec].

## Usage

Not published — this package isn't consumed through the npm registry at all. It's imported by relative path from its built `dist/` output, currently by `packages/kdbx` (see `kdbx.ts` and `protected-stream.ts`). If you want to use it outside this repo, copy the package or import its `src/` directly; there's nothing else it depends on.

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

[org]: https://github.com/keepass-web
[spec]: ./SPEC.md
