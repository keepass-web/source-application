# Specification

## KDBX Format

The KDBX format is documented by the KeePass project.

- **Complete specification**: https://keepass.info/help/kb/kdbx.html — the authoritative reference for the binary format (header, variant dictionary, key computation, HMAC-protected block stream, inner header, inner encryption, XML document). Currently defines KDBX 4.1.
- **KDBX 4** (changes from KDBX 3.1 to 4): https://keepass.info/help/kb/kdbx_4.html
- **KDBX 4.1** (changes from KDBX 4 to 4.1): https://keepass.info/help/kb/kdbx_4.1.html
- **KDBX 3.1**: no standalone page; see the KDBX 4 page above for the 3.1 → 4 differences, plus the complete specification for shared internals.
- **XML schema**: https://keepass.info/help/download/KDBX_XML.xsd (KDBX 4.1 XML Schema).

### Secondary signatures

| Byte | Format |
|------|--------|
| `0x67` | KDBX 3.1 and 4.x — implemented here |
| `0x66` | KDBX pre-release — implemented upon request |
| `0x65` | KeePass 1.x `.kdb` — implemented upon request, separate repository |

### Cryptographic dependencies

| Primitive | Source |
|-----------|--------|
| AES-256-CBC (outer encryption, KDBX 3.1) | WebCrypto |
| ChaCha20 (outer encryption, KDBX 4.x) | `chacha20` |
| AES-KDF (key derivation, KDBX 3.1) | WebCrypto |
| Argon2d / Argon2id (key derivation, KDBX 4.x) | `argon2` |
| HMAC-SHA256 (block authentication, KDBX 4.x) | WebCrypto |
| Salsa20 (inner random stream, KDBX 3.1) | `chacha20` |
| ChaCha20 (inner random stream, KDBX 4.x) | `chacha20` |

### Test corpus

Two components:

- To test correctness, synthetic round-trip tests: this library creates a
  database, saves it, and loads it back, across every supported version/
  cipher/KDF combination (`tests/kdbx.test.ts`, `tests/kdbx-internals.test.ts`,
  and others alongside them). This proves internal consistency but not
  interoperability with any other implementation.
- To test interoperability, real `.kdbx` files produced by independent
  implementations, not by this library's writer. Currently sourced from
  `keepass-rs` (MIT) and `KeePassJava2` (Apache-2.0); see [the fixture
  manifest][fixtures-manifest] for exact provenance, licenses, and what each
  file exercises, and `tests/corpus.test.ts` for the assertions. Real
  KeePassXC-produced fixtures are not yet included (their test data is
  GPL-licensed, so it isn't copied wholesale into this MIT-licensed repo);
  `File::KDBX` fixtures aren't included yet either. Both are candidates for a
  future addition.

## Merging

KDBX has one writer at a time and no field-level locking, so two copies of a database edited separately can only be reconciled object by object, from the times and records each copy carries. `Kdbx#mergeIn` does that by the rules of KeePass's own [synchronization][sync], so merging two copies here gives the same result as merging them in KeePass or KeePassXC, and a copy merged here and later merged there doesn't come out differently:

- Groups and entries are matched by UUID. An object only one copy holds is kept. For one both hold, the copy with the newer `LastModificationTime` stays current, and for an entry the other copy goes into its History, so neither version is lost. Two copies of an entry count as different only if their content differs; layout, access time, usage count, location and empty standard fields don't count, as they don't in KeePass.
- Placement follows the newer `LocationChanged`, so a move made in either copy survives it. A group is never moved into its own subtree.
- The `DeletedObjects` records of both copies are combined. A record removes an entry not edited since the deletion, and a group that is also empty, so an edit made after a deletion elsewhere is never silently lost.
- Histories are combined by modification time and trimmed to `HistoryMaxItems` and `HistoryMaxSize`, as an edit trims them. Database settings follow their own `*Changed` times, and custom icons and custom data are combined.
- The other copy's attachments join this database's pool by content.

One departure from KeePass: when both copies changed an entry within the same second, KeePass keeps this copy and drops the other, while here the other goes into History, so neither change is lost.

Deletions only carry over where a record exists. A file from a writer that keeps no deletion records brings deleted objects back, which for a password manager is the safe direction.

## Bundle-safe naming convention

This library is concatenated with `chacha20` and `argon2` into a single `<script>` block for the self-contained distributable. Because all files share one JavaScript scope in that context, module-scope identifiers within kdbx that are **not** part of the public API must carry the prefix `KX_` (constants) or `kx_` (functions) if they collide with an identically named internal in a sibling library.

Exported symbols (everything re-exported from `src/index.ts`) are part of the public API and must **not** carry the prefix.

[fixtures-manifest]: tests/fixtures/MANIFEST.md
[sync]: https://keepass.info/help/v2/sync.html
