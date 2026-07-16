import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addEntryAttachment,
  appendChild,
  Credentials,
  createElement,
  createEntry,
  createGroup,
  getAttribute,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryHistory,
  getText,
  Kdbx,
  type KdbxCreateOptions,
  pushHistorySnapshot,
  removeEntryAttachment,
  renameEntryAttachment,
  setAttribute,
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

test('addBinary dedupes identical content and returns a stable pool index', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), options({ version: 4 }));
  const dataA = new Uint8Array([1, 2, 3]);
  const dataB = new Uint8Array([1, 2, 3]); // same content, different array instance
  const dataC = new Uint8Array([4, 5, 6]);

  const refA = kdbx.addBinary(dataA);
  const refB = kdbx.addBinary(dataB);
  const refC = kdbx.addBinary(dataC);

  assert.equal(refB, refA);
  assert.notEqual(refC, refA);
  assert.deepEqual(kdbx.getBinaryData(refA), dataA);
  assert.deepEqual(kdbx.getBinaryData(refC), dataC);
  assert.equal(kdbx.getBinaryData(999), undefined);
});

test('an attachment added, saved, and reloaded round-trips its name and bytes', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 4 }));
  const entry = createEntry({ title: 'Has an attachment' });
  appendChild(kdbx.getRootGroup(), entry);

  const data = new TextEncoder().encode('hello attachment');
  const ref = kdbx.addBinary(data);
  addEntryAttachment(entry, 'notes.txt', ref);

  const reloaded = await Kdbx.load(await kdbx.save(), credentials);
  const attachments = getEntryAttachments(firstEntry(reloaded));
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.name, 'notes.txt');
  assert.deepEqual(reloaded.getBinaryData(attachments[0]?.ref as number), data);
});

test('KDBX 3.1: an attachment added, saved, and reloaded round-trips its name and bytes', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 3 }));
  const entry = createEntry({ title: 'Has an attachment' });
  appendChild(kdbx.getRootGroup(), entry);

  const data = new TextEncoder().encode('hello 3.1 attachment');
  const ref = kdbx.addBinary(data);
  addEntryAttachment(entry, 'notes.txt', ref);

  const reloaded = await Kdbx.load(await kdbx.save(), credentials);
  assert.equal(reloaded.header.version.major, 3);
  const attachments = getEntryAttachments(firstEntry(reloaded));
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0]?.name, 'notes.txt');
  assert.deepEqual(reloaded.getBinaryData(attachments[0]?.ref as number), data);
});

test('KDBX 3.1: an attachment referenced only from a History revision survives a save/reload', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 3 }));
  const entry = createEntry({ title: 'v1' });
  appendChild(kdbx.getRootGroup(), entry);

  const data = new TextEncoder().encode('archived attachment');
  const ref = kdbx.addBinary(data);
  addEntryAttachment(entry, 'old.txt', ref);
  pushHistorySnapshot(kdbx.root, entry);
  // The live entry no longer references the attachment; only its History does.
  removeEntryAttachment(entry, 'old.txt');

  const reloaded = await Kdbx.load(await kdbx.save(), credentials);
  const reloadedEntry = firstEntry(reloaded);
  assert.equal(getEntryAttachments(reloadedEntry).length, 0);
  const historyAttachments = getEntryAttachments(getEntryHistory(reloadedEntry)[0] as XmlElement);
  assert.equal(historyAttachments.length, 1);
  assert.deepEqual(reloaded.getBinaryData(historyAttachments[0]?.ref as number), data);
});

test('renameEntryAttachment renames the matching attachment and leaves others alone; a missing name is a no-op', () => {
  const entry = createEntry({ title: 'Multi' });
  addEntryAttachment(entry, 'a.txt', 0);
  addEntryAttachment(entry, 'b.txt', 1);

  renameEntryAttachment(entry, 'a.txt', 'renamed.txt');
  assert.deepEqual(
    getEntryAttachments(entry).map((a) => a.name),
    ['renamed.txt', 'b.txt'],
  );

  renameEntryAttachment(entry, 'missing.txt', 'ignored.txt');
  assert.deepEqual(
    getEntryAttachments(entry).map((a) => a.name),
    ['renamed.txt', 'b.txt'],
  );
});

test('removeEntryAttachment removes only the matching attachment; a missing name is a no-op', () => {
  const entry = createEntry({ title: 'Multi' });
  addEntryAttachment(entry, 'a.txt', 0);
  addEntryAttachment(entry, 'b.txt', 1);

  removeEntryAttachment(entry, 'a.txt');
  assert.deepEqual(
    getEntryAttachments(entry).map((a) => a.name),
    ['b.txt'],
  );

  removeEntryAttachment(entry, 'missing.txt');
  assert.deepEqual(
    getEntryAttachments(entry).map((a) => a.name),
    ['b.txt'],
  );
});

test('getEntryAttachments skips a malformed <Binary> child (no Key, or Value with no Ref)', () => {
  const entry = createEntry({ title: 'Malformed' });

  const noKey = createElement('Binary');
  const noKeyValue = createElement('Value');
  setAttribute(noKeyValue, 'Ref', '0');
  appendChild(noKey, noKeyValue);
  appendChild(entry, noKey);

  const noRef = createElement('Binary');
  appendChild(noRef, createElement('Key', 'no-ref.txt'));
  appendChild(noRef, createElement('Value'));
  appendChild(entry, noRef);

  assert.deepEqual(getEntryAttachments(entry), []);
});

test("save() drops an unreferenced binary and remaps the survivor's Ref to stay contiguous", async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 4 }));
  const root = kdbx.getRootGroup();
  const dropEntry = createEntry({ title: 'Drop' });
  const keepEntry = createEntry({ title: 'Keep' });
  appendChild(root, dropEntry);
  // Nested one level deep so pruning's tree walk must recurse into a
  // subgroup, not just scan the root group's direct entries.
  const subGroup = createGroup('Sub');
  appendChild(root, subGroup);
  appendChild(subGroup, keepEntry);

  const dropData = new TextEncoder().encode('drop me');
  const keepData = new TextEncoder().encode('keep me');
  const dropRef = kdbx.addBinary(dropData); // pool index 0
  const keepRef = kdbx.addBinary(keepData); // pool index 1
  addEntryAttachment(dropEntry, 'drop.txt', dropRef);
  addEntryAttachment(keepEntry, 'keep.txt', keepRef);

  // Remove the "drop" entry's only attachment before its first save, so pool
  // index 0 is genuinely unreferenced and index 1 must be remapped to 0.
  removeEntryAttachment(dropEntry, 'drop.txt');

  const reloaded = await Kdbx.load(await kdbx.save(), credentials);
  assert.equal(reloaded.binaries.length, 1, 'the unreferenced binary was dropped');

  const reloadedSub = getChild(reloaded.getRootGroup(), 'Group') as XmlElement;
  const reloadedKeep = getChild(reloadedSub, 'Entry') as XmlElement;
  assert.equal(fieldsOf(reloadedKeep).Title, 'Keep');
  const attachments = getEntryAttachments(reloadedKeep);
  assert.equal(attachments.length, 1);
  assert.deepEqual(reloaded.getBinaryData(attachments[0]?.ref as number), keepData);
});

test('save() defensively handles malformed/stale <Binary> references without throwing', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, options({ version: 4 }));
  const entry = createEntry({ title: 'Malformed refs' });
  appendChild(kdbx.getRootGroup(), entry);

  const data = new TextEncoder().encode('real attachment');
  const ref = kdbx.addBinary(data);
  // Two attachments sharing the same valid ref.
  addEntryAttachment(entry, 'first.txt', ref);
  addEntryAttachment(entry, 'second.txt', ref);
  // A stale ref pointing past the end of the pool.
  addEntryAttachment(entry, 'stale.txt', 999);
  // A <Binary> with no <Value> child at all.
  const noValue = createElement('Binary');
  appendChild(noValue, createElement('Key', 'no-value.txt'));
  appendChild(entry, noValue);
  // A <Binary> with a <Value> present but no Ref attribute on it.
  const noRefAttr = createElement('Binary');
  appendChild(noRefAttr, createElement('Key', 'no-ref-attr.txt'));
  appendChild(noRefAttr, createElement('Value'));
  appendChild(entry, noRefAttr);

  const reloaded = await Kdbx.load(await kdbx.save(), credentials);
  assert.equal(
    reloaded.binaries.length,
    1,
    'the single real binary survives, shared by two attachments',
  );

  const reloadedEntry = firstEntry(reloaded);
  const named = (name: string) => getEntryAttachments(reloadedEntry).find((a) => a.name === name);
  assert.deepEqual(reloaded.getBinaryData(named('first.txt')?.ref as number), data);
  assert.deepEqual(reloaded.getBinaryData(named('second.txt')?.ref as number), data);
  // The stale Ref is left untouched (harmless: resolves to no data at read time).
  assert.equal(named('stale.txt')?.ref, 999);
  assert.equal(reloaded.getBinaryData(999), undefined);
});
