import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendChild,
  Credentials,
  createEntry,
  getAttribute,
  getChild,
  getChildren,
  getText,
  Kdbx,
  type KdbxCreateOptions,
  type XmlElement,
} from '../src/index.ts';

// Fast KDF settings so the suite runs quickly while exercising the real code paths.
const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;

function options(overrides: KdbxCreateOptions): KdbxCreateOptions {
  return { argon2: FAST_ARGON2, aesKdfRounds: 1000n, ...overrides };
}

function fieldsOf(entry: XmlElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const string of getChildren(entry, 'String')) {
    const key = getText(getChild(string, 'Key') as XmlElement);
    out[key] = getText(getChild(string, 'Value') as XmlElement);
  }
  return out;
}

function firstEntry(kdbx: Kdbx): XmlElement {
  const entry = getChild(kdbx.getRootGroup(), 'Entry');
  if (!entry) {
    throw new Error('no entry found');
  }
  return entry;
}

const CONFIGS: Array<{ name: string; options: KdbxCreateOptions }> = [
  {
    name: 'KDBX4 ChaCha20 + Argon2id',
    options: options({ version: 4, cipher: 'chacha20', kdf: 'argon2id' }),
  },
  { name: 'KDBX4 AES + Argon2d', options: options({ version: 4, cipher: 'aes', kdf: 'argon2d' }) },
  {
    name: 'KDBX4 ChaCha20 + AES-KDF',
    options: options({ version: 4, cipher: 'chacha20', kdf: 'aes' }),
  },
  {
    name: 'KDBX4 AES + Argon2id, uncompressed',
    options: options({ version: 4, cipher: 'aes', kdf: 'argon2id', compression: false }),
  },
  { name: 'KDBX3.1 AES + Salsa20', options: options({ version: 3 }) },
  {
    name: 'KDBX3.1 AES + Salsa20, uncompressed',
    options: options({ version: 3, compression: false }),
  },
];

for (const config of CONFIGS) {
  test(`round-trips a database: ${config.name}`, async () => {
    const credentials = Credentials.fromPassword('correct horse battery staple');
    const kdbx = await Kdbx.create(credentials, config.options);
    appendChild(
      kdbx.getRootGroup(),
      createEntry({
        title: 'GitHub',
        username: 'octocat',
        password: 'hunter2 ❤',
        url: 'https://github.com',
        notes: 'line1\nline2 & <stuff>',
      }),
    );

    const saved = await kdbx.save();
    const reloaded = await Kdbx.load(
      saved,
      Credentials.fromPassword('correct horse battery staple'),
    );

    const fields = fieldsOf(firstEntry(reloaded));
    assert.equal(fields.Title, 'GitHub');
    assert.equal(fields.UserName, 'octocat');
    assert.equal(fields.Password, 'hunter2 ❤');
    assert.equal(fields.URL, 'https://github.com');
    assert.equal(fields.Notes, 'line1\nline2 & <stuff>');

    // The password field is still marked protected after load.
    const passwordValue = getChildren(firstEntry(reloaded), 'String')
      .map((s) => getChild(s, 'Value') as XmlElement)
      .find((v) => getAttribute(v, 'Protected') === 'True');
    assert.ok(passwordValue, 'password value should keep Protected="True"');
  });
}

test('wrong credentials are rejected', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('right'), options({ version: 4 }));
  const saved = await kdbx.save();
  await assert.rejects(() => Kdbx.load(saved, Credentials.fromPassword('wrong')));
});

test('wrong credentials are rejected (KDBX 3.1)', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('right'), options({ version: 3 }));
  const saved = await kdbx.save();
  await assert.rejects(() => Kdbx.load(saved, Credentials.fromPassword('wrong')));
});

test('multiple protected fields decrypt in document order', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 4 }));
  const group = kdbx.getRootGroup();
  appendChild(group, createEntry({ title: 'A', password: 'first-secret' }));
  appendChild(group, createEntry({ title: 'B', password: 'second-different-length-secret' }));

  const reloaded = await Kdbx.load(await kdbx.save(), Credentials.fromPassword('pw'));
  const entries = getChildren(reloaded.getRootGroup(), 'Entry');
  assert.equal(fieldsOf(entries[0] as XmlElement).Password, 'first-secret');
  assert.equal(fieldsOf(entries[1] as XmlElement).Password, 'second-different-length-secret');
});

test('edit, save, and reload preserves changes', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 4 }));
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'Original', password: 'p1' }));

  const once = await Kdbx.load(await kdbx.save(), Credentials.fromPassword('pw'));
  // Add a second entry and re-save.
  appendChild(once.getRootGroup(), createEntry({ title: 'Added', password: 'p2' }));
  const twice = await Kdbx.load(await once.save(), Credentials.fromPassword('pw'));

  const titles = getChildren(twice.getRootGroup(), 'Entry').map((e) => fieldsOf(e).Title);
  assert.deepEqual(titles, ['Original', 'Added']);
});

test('a password-and-keyfile credential round-trips', async () => {
  const keyFile = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);
  const make = () => new Credentials({ password: 'pw', keyFile });
  const kdbx = await Kdbx.create(make(), options({ version: 4 }));
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'KF', password: 'secret' }));
  const saved = await kdbx.save();
  const reloaded = await Kdbx.load(saved, make());
  assert.equal(fieldsOf(firstEntry(reloaded)).Password, 'secret');
  // The same database must not open with the password alone.
  await assert.rejects(() => Kdbx.load(saved, Credentials.fromPassword('pw')));
});
