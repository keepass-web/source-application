/**
 * Interoperability corpus: real .kdbx files produced by independent
 * implementations (keepass-rs, KeePassJava2), not by this library's own
 * writer. See fixtures/MANIFEST.md for provenance, licenses, and what each
 * file exercises.
 *
 * Every assertion here is grounded either in the source project's own test
 * suite (credentials, entry/group counts) or in this file's on-disk header
 * bytes (KDBX version) — nothing here is a guess.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  Credentials,
  getChild,
  getChildren,
  getEntryAttachments,
  getText,
  isInRecycleBin,
  Kdbx,
  type XmlElement,
} from '../src/index.ts';

const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url));

function fixture(...parts: string[]): Uint8Array {
  return new Uint8Array(readFileSync(join(fixturesDir, ...parts)));
}

function countAll(group: XmlElement): { groups: number; entries: number } {
  let groups = 1;
  let entries = getChildren(group, 'Entry').length;
  for (const sub of getChildren(group, 'Group')) {
    const counts = countAll(sub);
    groups += counts.groups;
    entries += counts.entries;
  }
  return { groups, entries };
}

function findGroup(root: XmlElement, name: string): XmlElement {
  const stack = [root];
  for (let group = stack.pop(); group; group = stack.pop()) {
    const nameEl = getChild(group, 'Name');
    if (nameEl && getText(nameEl) === name) {
      return group;
    }
    stack.push(...getChildren(group, 'Group'));
  }
  throw new Error(`no group named ${name}`);
}

// --- keepass-rs (tests/resources/) ------------------------------------------

test('corpus/keepass-rs: 3.1 password-only, nested groups and entries', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_with_password.kdbx'),
    Credentials.fromPassword('demopass'),
  );
  assert.equal(kdbx.header.version.major, 3);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'sample');
  assert.equal(getChildren(root, 'Group').length, 3);
  assert.equal(getChildren(root, 'Entry').length, 2);
  assert.deepEqual(countAll(root), { groups: 5, entries: 6 });
});

test('corpus/keepass-rs: 3.1 keyfile-only (raw), no password', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_with_keyfile.kdbx'),
    new Credentials({ keyFile: fixture('keepass-rs', 'test_key.key') }),
  );
  assert.equal(kdbx.header.version.major, 3);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
  assert.deepEqual(countAll(root), { groups: 1, entries: 1 });
});

test('corpus/keepass-rs: 3.1 keyfile-only (XML v1), no password', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_with_keyfile_xml.kdbx'),
    new Credentials({ keyFile: fixture('keepass-rs', 'test_key_xml.key') }),
  );
  assert.equal(kdbx.header.version.major, 3);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
  assert.equal(getChildren(root, 'Group').length, 2);
  assert.equal(getChildren(root, 'Entry').length, 2);
  assert.deepEqual(countAll(root), { groups: 5, entries: 6 });
});

test('corpus/keepass-rs: 3.1 with a >1 MiB attachment loads, spanning multiple hashed blocks', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_kdb3_with_file_larger_1mb.kdbx'),
    Credentials.fromPassword('demopass'),
  );
  assert.equal(kdbx.header.version.major, 3);
  assert.deepEqual(countAll(kdbx.getRootGroup()), { groups: 1, entries: 1 });

  assert.equal(kdbx.binaries.length, 1);
  const [entry] = getChildren(kdbx.getRootGroup(), 'Entry');
  const [attachment] = getEntryAttachments(entry as XmlElement);
  assert.equal(attachment?.name, 'sample.png');
  const data = kdbx.getBinaryData(attachment?.ref as number);
  assert.equal(data?.length, 2 * 1024 * 1024);
  assert.equal(
    createHash('sha256')
      .update(data as Uint8Array)
      .digest('hex'),
    '0ff32c46d38a29e28f77802520c04340753169e7f4edcbc841de4522f8bfe800',
  );
});

for (const [file, kdf] of [
  ['test_db_kdbx4_with_password_argon2.kdbx', 'argon2d'],
  ['test_db_kdbx4_with_password_argon2id.kdbx', 'argon2id'],
] as const) {
  test(`corpus/keepass-rs: 4.0 password-only, AES cipher + ${kdf}`, async () => {
    const kdbx = await Kdbx.load(fixture('keepass-rs', file), Credentials.fromPassword('demopass'));
    assert.equal(kdbx.header.version.major, 4);
    const root = kdbx.getRootGroup();
    assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
    assert.equal(getChildren(root, 'Entry').length, 2);
  });
}

for (const [file, kdf] of [
  ['test_db_kdbx4_with_password_argon2_chacha20.kdbx', 'argon2d'],
  ['test_db_kdbx4_with_password_argon2id_chacha20.kdbx', 'argon2id'],
] as const) {
  test(`corpus/keepass-rs: 4.0 password-only, ChaCha20 cipher + ${kdf}`, async () => {
    const kdbx = await Kdbx.load(fixture('keepass-rs', file), Credentials.fromPassword('demopass'));
    assert.equal(kdbx.header.version.major, 4);
    const root = kdbx.getRootGroup();
    assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
    assert.equal(getChildren(root, 'Entry').length, 1);
  });
}

test('corpus/keepass-rs: 4.0 password + XML keyfile v2 (hex)', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_kdbx4_with_keyfile_v2.kdbx'),
    new Credentials({
      password: 'demopass',
      keyFile: fixture('keepass-rs', 'test_db_kdbx4_with_keyfile_v2.keyx'),
    }),
  );
  assert.equal(kdbx.header.version.major, 4);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
  assert.equal(getChildren(root, 'Entry').length, 1);
});

test('corpus/keepass-rs: 4.0 password + XML keyfile v2 with tabs in the key data (issue #284)', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_kdbx4_with_keyfile_v2_alt.kdbx'),
    new Credentials({
      password: 'demopass',
      keyFile: fixture('keepass-rs', 'test_db_kdbx4_with_keyfile_v2_alt.keyx'),
    }),
  );
  assert.equal(kdbx.header.version.major, 4);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'testdb02');
  assert.equal(getChildren(root, 'Group').length, 6);
  assert.equal(getChildren(root, 'Entry').length, 2);
});

test('corpus/keepass-rs: 4.0 with a deleted entry has a real Recycle Bin group', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_kdbx4_with_password_deleted_entry.kdbx'),
    Credentials.fromPassword('demopass'),
  );
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Root');
  const bin = findGroup(root, 'Recycle Bin');
  assert.ok(isInRecycleBin(kdbx.root, bin));
});

test('corpus/keepass-rs: 4.1 tags, custom icons, and custom data', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepass-rs', 'test_db_kdbx41_with_password_aes.kdbx'),
    Credentials.fromPassword('demopass'),
  );
  assert.equal(kdbx.header.version.major, 4);
  assert.equal(kdbx.header.version.minor, 1);
  const root = kdbx.getRootGroup();
  assert.equal(getText(getChild(root, 'Name') as XmlElement), 'Database');
  assert.equal(getChildren(root, 'Group').length, 2);
  assert.equal(getChildren(root, 'Entry').length, 4);

  const tagged = findGroup(root, 'Group with tags');
  const tagsEl = getChild(tagged, 'Tags');
  assert.ok(tagsEl);
  assert.deepEqual(
    getText(tagsEl)
      .split(';')
      .map((t) => t.trim()),
    ['a', 'b', 'c'],
  );
});

test('corpus/keepass-rs: garbage bytes are rejected (bad signature)', async () => {
  await assert.rejects(
    Kdbx.load(fixture('keepass-rs', 'broken_random_data.kdbx'), Credentials.fromPassword('')),
  );
});

test('corpus/keepass-rs: a real file with a mangled version field is rejected', async () => {
  await assert.rejects(
    Kdbx.load(fixture('keepass-rs', 'broken_kdbx_version.kdbx'), Credentials.fromPassword('')),
  );
});

// --- KeePassJava2 (test/src/test/resources/) --------------------------------

test('corpus/keepassjava2: 3.1 with attachments, including one shared by two entries', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'Attachment.kdbx'),
    Credentials.fromPassword('123'),
  );
  assert.equal(kdbx.header.version.major, 3);
  assert.equal(kdbx.header.version.minor, 1);
  assert.equal(kdbx.binaries.length, 2);

  const entries = getChildren(kdbx.getRootGroup(), 'Entry');
  const perEntryNames = entries.map((entry) =>
    getEntryAttachments(entry)
      .map((a) => a.name)
      .sort(),
  );
  assert.deepEqual(
    perEntryNames.sort((a, b) => a.length - b.length),
    [['letter J.jpeg'], ['letter J.jpeg', 'letter L.jpeg']],
  );
});

test('corpus/keepassjava2: 4.0 ChaCha20 + Argon2 with a real attachment', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'V4-ChaCha20-Argon2-Attachment.kdbx'),
    Credentials.fromPassword('123'),
  );
  assert.equal(kdbx.header.version.major, 4);
  assert.ok(kdbx.binaries.length > 0);

  const withAttachment = getChildren(kdbx.getRootGroup(), 'Entry').find(
    (entry) => getEntryAttachments(entry).length > 0,
  );
  assert.ok(withAttachment, 'expected at least one entry with an attachment');
  const [attachment] = getEntryAttachments(withAttachment as XmlElement);
  const data = kdbx.getBinaryData(attachment?.ref as number);
  assert.ok(data && data.length > 0);
});

test('corpus/keepassjava2: 4.0 AES-KDF + AES cipher', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'V4-AES-AES.kdbx'),
    Credentials.fromPassword('123'),
  );
  assert.equal(kdbx.header.version.major, 4);
  assert.ok(getChildren(kdbx.getRootGroup(), 'Entry').length > 0);
});

test('corpus/keepassjava2: 4.1 format baseline', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'Database-4.1-123.kdbx'),
    Credentials.fromPassword('123'),
  );
  assert.equal(kdbx.header.version.major, 4);
  assert.equal(kdbx.header.version.minor, 1);
});

test('corpus/keepassjava2: 3.1 generic conformance baseline', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'test123.kdbx'),
    Credentials.fromPassword('123'),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: empty-string password (not absent)', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'EmptyPassword.kdbx'),
    Credentials.fromPassword(''),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: empty password combined with a keyfile', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'EmptyPasswordWithKey.kdbx'),
    new Credentials({ password: '', keyFile: fixture('keepassjava2', 'EmptyPasswordWithKey.key') }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: keyfile only, no password field at all', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'NoPasswordWithKey.kdbx'),
    new Credentials({ keyFile: fixture('keepassjava2', 'NoPasswordWithKey.key') }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: 32-byte raw keyfile', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'kdbx_keyfile32.kdbx'),
    new Credentials({ password: '123', keyFile: fixture('keepassjava2', 'keyfile32') }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: 64-character hex keyfile', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'kdbx_keyfile64.kdbx'),
    new Credentials({ password: '123', keyFile: fixture('keepassjava2', 'keyfile64') }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: real bug report, malformed timestamp (issue #27)', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'issue-27', 'bogus-timestamp2.kdbx'),
    Credentials.fromPassword('passwordless'),
  );
  assert.equal(kdbx.header.version.major, 3);
  const entries = getChildren(kdbx.getRootGroup(), 'Entry');
  assert.ok(entries.length > 0);
});

test('corpus/keepassjava2: real bug report, V2 (hex) keyfile (issue #38)', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'issue-38', 'Database.kdbx'),
    new Credentials({
      password: 'MyPassword',
      keyFile: fixture('keepassjava2', 'issue-38', 'Database.keyx'),
    }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: v2 keyfile with a valid integrity hash opens', async () => {
  const kdbx = await Kdbx.load(
    fixture('keepassjava2', 'kdbx_hash_test.kdbx'),
    new Credentials({ password: '123', keyFile: fixture('keepassjava2', 'kdbx_hash_test.keyx') }),
  );
  assert.equal(kdbx.header.version.major, 3);
});

test('corpus/keepassjava2: v2 keyfile with a tampered integrity hash is rejected', async () => {
  await assert.rejects(
    Kdbx.load(
      fixture('keepassjava2', 'kdbx_hash_test.kdbx'),
      new Credentials({
        password: '123',
        keyFile: fixture('keepassjava2', 'kdbx_hash_test_wrong_hash.keyx'),
      }),
    ),
    /checksum mismatch/,
  );
});
