# kdbx

KDBX 3.1 and 4.x parser and serializer for the [keepass-web][org] project.

Handles KDBX files reporting 0x67 format.

## Specification

See [SPEC.md][spec].

## Usage

Not published — this package isn't consumed through the npm registry at all. It's bundled into `pages/0x67` (see that page's `bundle-iife.json`), and imports [`chacha20`][chacha20] (ChaCha20/Salsa20) and [`argon2`][argon2] (Argon2d/Argon2id) by relative path from their built `dist/` output. AES, HMAC, SHA, and GZip come from WebCrypto and the Web Streams compression API, so the package is isomorphic (browser and Node) and otherwise dependency-free.

The example below assumes you've built this package (`npm run build`) and are importing its compiled output directly, e.g. from a sibling directory:

```ts
import { Kdbx, Credentials, createEntry, appendChild, getText, getChild } from './kdbx/dist/src/index.js';

// Create a new KDBX 4.x database (ChaCha20 + Argon2id by default).
const credentials = Credentials.fromPassword('correct horse battery staple');
const db = await Kdbx.create(credentials, { databaseName: 'My Vault' });
appendChild(db.getRootGroup(), createEntry({ title: 'GitHub', username: 'octocat', password: 's3cret' }));
const bytes = await db.save();

// Load it back.
const reopened = await Kdbx.load(bytes, credentials);
const entry = getChild(reopened.getRootGroup(), 'Entry')!;
```

`Kdbx.create` accepts `version` (3 or 4), `cipher` (`aes`/`chacha20`), `kdf` (`argon2id`/`argon2d`/`aes`), `compression`, and KDF tuning. The canonical state of a database is its `<KeePassFile>` XML tree (`db.root`); `Protected="True"` values are held as plaintext in memory and (re-)encrypted with the inner random stream on save.

## Development

```sh
npm ci
npm run typecheck
npm run lint
npm test
```

[org]: https://github.com/keepass-web
[spec]: ./SPEC.md
[chacha20]: ../chacha20
[argon2]: ../argon2
