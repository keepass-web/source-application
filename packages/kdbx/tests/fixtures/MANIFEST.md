# Fixture manifest

Real `.kdbx` files produced by independent KDBX implementations, vendored here
so `corpus.test.ts` can verify this library actually interoperates with
other people's output — not just its own writer reading its own output back.
Every file is a small, permissively-licensed test asset from the source
project's own test suite; none is fetched at build or test time (see
[SPEC.md's "Test corpus" section][spec] for why these are committed rather
than downloaded on demand).

These are test-only inputs under `packages/kdbx/tests/`. They are never
referenced from `src/`, so they never enter `build/` or `dist/`.

## Sources

- **[keepass-rs][keepass-rs]** — Rust KDBX parser, MIT license (full text at
  [`keepass-rs/LICENSE`][keepass-rs-license]), pinned at commit
  [`8c76407`][keepass-rs-commit].
- **[KeePassJava2][keepassjava2]** — Java KDBX library, Apache-2.0 license
  (full text at [`keepassjava2/LICENSE`][keepassjava2-license]), pinned at
  commit [`b231847`][keepassjava2-commit].

Neither project's fixtures are modified from upstream; filenames match the
source repository except where noted below.

## `keepass-rs/` (from `tests/resources/`)

| File | Version | Credentials | Exercises |
|---|---|---|---|
| `test_db_with_password.kdbx` | KDBX 3.1 | password `demopass` | Baseline: 3 groups/2 entries at root, 5 groups/6 entries total |
| `test_db_with_keyfile.kdbx` + `test_key.key` | KDBX 3.1 | keyfile only (128-byte raw file, falls through to the SHA-256(bytes) path) | Keyfile-only credentials, no password |
| `test_db_with_keyfile_xml.kdbx` + `test_key_xml.key` | KDBX 3.1 | keyfile only, XML keyfile v1 (Base64) | XML keyfile v1 parsing |
| `test_db_kdbx3_with_chacha20_protected_fields.kdbx` | KDBX 3.1 | — | 3.1 file with **ChaCha20** as the inner protected-stream cipher instead of Salsa20 — this library's own writer always picks Salsa20 for 3.1, so this is the only fixture exercising that branch against real ciphertext |
| `test_db_kdb3_with_file_larger_1mb.kdbx` | KDBX 3.1 | password `demopass` | One entry with a >1 MiB attachment — forces multi-block hashed-block-stream chunking and a large real base64 blob through the new Meta/Binaries decoder |
| `test_db_kdbx4_with_password_argon2.kdbx` | KDBX 4.0 | password `demopass` | Argon2d + AES cipher |
| `test_db_kdbx4_with_password_argon2id.kdbx` | KDBX 4.0 | password `demopass` | Argon2id + AES cipher |
| `test_db_kdbx4_with_password_argon2_chacha20.kdbx` | KDBX 4.0 | password `demopass` | Argon2d + ChaCha20 cipher |
| `test_db_kdbx4_with_password_argon2id_chacha20.kdbx` | KDBX 4.0 | password `demopass` | Argon2id + ChaCha20 cipher |
| `test_db_kdbx4_with_keyfile_v2.kdbx` + `.keyx` | KDBX 4.0 | password `demopass` + XML keyfile v2 (hex) | Combined password+keyfile credentials, XML keyfile v2 |
| `test_db_kdbx4_with_keyfile_v2_alt.kdbx` + `.keyx` | KDBX 4.0 | password `demopass` + XML keyfile v2 | Real upstream bug fixture (issue #284): tabs inside the keyfile's `<Data>` content |
| `test_db_kdbx4_with_password_deleted_entry.kdbx` | KDBX 4.0 | password `demopass` | `Meta/RecycleBinUUID` pointing at a real "Recycle Bin" group with a deleted entry |
| `test_db_kdbx41_with_password_aes.kdbx` | KDBX 4.1 | password `demopass` | 4.1-specific XML: tags, custom icons, custom data, "previous parent" fields |
| `broken_random_data.kdbx` | — | — | Garbage bytes; real "bad signature" negative case |
| `broken_kdbx_version.kdbx` | — | — | Real "unsupported version" negative case |

## `keepassjava2/` (from `test/src/test/resources/`)

| File | Version | Credentials | Exercises |
|---|---|---|---|
| `Attachment.kdbx` | KDBX 3.1 | password `123` | **Attachment on a 3.1 file** — the direct fixture for the new Meta/Binaries support |
| `V4-ChaCha20-Argon2-Attachment.kdbx` | KDBX 4.0 | password `123` | ChaCha20 + Argon2, attachment on a 4.x file (regression check) |
| `V4-AES-AES.kdbx` | KDBX 4.0 | password `123` | AES-KDF + AES cipher; known entry with a known creation timestamp |
| `Database-4.1-123.kdbx` | KDBX 4.1 | password `123` | 4.1 format baseline |
| `test123.kdbx` | KDBX 3.1 | password `123` | Generic 3.1 conformance baseline |
| `EmptyPassword.kdbx` | — | empty-string password | Empty (not absent) password credential |
| `EmptyPasswordWithKey.kdbx` + `.key` | — | empty password + keyfile | Empty password combined with a keyfile |
| `NoPasswordWithKey.kdbx` + `.key` | — | keyfile only, no password field at all | Keyfile-only credentials (distinct code path from "empty password + keyfile") |
| `kdbx_keyfile32.kdbx` + `keyfile32` | — | password `123` (per `KdbxKeyFileTest`) + 32-byte raw keyfile | Raw 32-byte keyfile branch |
| `kdbx_keyfile64.kdbx` + `keyfile64` | — | password `123` + 64-char hex keyfile | Hex-64 keyfile branch |
| `issue-27/bogus-timestamp2.kdbx` | KDBX 3.1 | password `passwordless` | Real bug report: malformed/edge-case timestamp handling |
| `issue-38/Database.kdbx` + `.keyx` | — | password `MyPassword` + XML keyfile v2 (hex) | Real bug report: V2 (hex) keyfile handling |
| `kdbx_hash_test.kdbx` + `kdbx_hash_test.keyx` | — | password `123` + XML keyfile v2 with a valid `Data Hash` checksum | XML keyfile v2 checksum verification |
| `kdbx_hash_test.kdbx` + `kdbx_hash_test_wrong_hash.keyx` | — | password `123` + XML keyfile v2 with a wrong `Data Hash` | A tampered XML keyfile v2 checksum is rejected |

[spec]: ../../SPEC.md
[keepass-rs]: https://github.com/sseemayer/keepass-rs
[keepass-rs-commit]: https://github.com/sseemayer/keepass-rs/tree/8c7640790a7c2be491dcf8adece36eeb9620b203
[keepass-rs-license]: keepass-rs/LICENSE
[keepassjava2]: https://github.com/jorabin/KeePassJava2
[keepassjava2-commit]: https://github.com/jorabin/KeePassJava2/tree/b231847a9f72a9a294badbe1ce541b14dfb9f0d8
[keepassjava2-license]: keepassjava2/LICENSE
