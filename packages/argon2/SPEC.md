# Specification

## Argon2

Implemented per **RFC 9106** — *Argon2 Memory-Hard Function for Password Hashing and Proof-of-Work Applications* (September 2021).

- https://www.rfc-editor.org/rfc/rfc9106

Variants implemented: Argon2d and Argon2id.

- **Argon2d** — used by KDBX 4.x with the Argon2d KDF setting.
- **Argon2id** — used by KDBX 4.x with the Argon2id KDF setting.

Test vectors are taken from Appendix B of RFC 9106.

## Bundle-safe naming convention

This library is concatenated with `chacha20` and `kdbx` into a single `<script>` block for the self-contained distributable. Because all files share one JavaScript scope in that context, module-scope identifiers that are **not** part of the public API must carry a file-local prefix to avoid collisions with identically named internals in sibling libraries:

| File | Prefix | Applies to |
|------|--------|------------|
| `blake2b.ts` | `B2_` / `b2_` | constants / functions |
| `argon2.ts` | `A2_` / `a2_` | constants / functions |
