# Specification

## ChaCha20

Implemented per **RFC 8439** — *ChaCha20 and Poly1305 for IETF Protocols* (June 2018).

- https://www.rfc-editor.org/rfc/rfc8439

Test vectors are taken from Appendix A of RFC 8439.

## Salsa20

Implemented per the **Salsa20 specification** by Daniel J. Bernstein.

- https://cr.yp.to/snuffle/spec.pdf

Salsa20 is required by the KDBX 3.1 inner random stream (protection stream).

## Bundle-safe naming convention

This library is concatenated with `argon2` and `kdbx` into a single `<script>` block for the self-contained distributable. Because all files share one JavaScript scope in that context, module-scope identifiers that are **not** part of the public API must carry the prefix `CC_` (for constants) or `cc_` (for functions and classes) to avoid collisions with identically named internals in sibling libraries.
