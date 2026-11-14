import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toBase64, toHex, utf8Encode } from '../src/bytes.ts';
import { sha256 } from '../src/crypto.ts';
import { Credentials, keyFileComponent } from '../src/index.ts';

test('rejects credentials with neither a password nor a key file', () => {
  assert.throws(() => new Credentials({}), /password and\/or a key file/);
});

test('accepts a password-only credential', async () => {
  const credentials = Credentials.fromPassword('pw');
  const key = await credentials.getCompositeKey();
  assert.equal(key.length, 32);
});

test('accepts a password given as raw bytes rather than a string', async () => {
  const withBytes = new Credentials({ password: utf8Encode('pw') });
  const withString = new Credentials({ password: 'pw' });
  assert.deepEqual(await withBytes.getCompositeKey(), await withString.getCompositeKey());
});

// --- keyFileComponent: detection order (XML > 32 raw bytes > ASCII hex-64 > SHA-256 fallback) ---

test('keyFileComponent: a raw 32-byte key file is used as-is', async () => {
  const keyFile = new Uint8Array(32).map((_, i) => i);
  assert.deepEqual(await keyFileComponent(keyFile), keyFile);
});

test('keyFileComponent: a 64-character ASCII hex key file is decoded as hex', async () => {
  const hex = 'a1'.repeat(32); // 64 hex chars, not 32 bytes long as text
  const component = await keyFileComponent(utf8Encode(hex));
  assert.equal(component.length, 32);
  assert.equal(component[0], 0xa1);
});

test('keyFileComponent: hex with a trailing newline is hashed whole, as KeePass and KeePassXC hash it (#128)', async () => {
  // What `openssl rand -hex 32 > key` writes; reading it as hex would key it
  // differently here than in every other KeePass client.
  for (const ending of ['\n', '\r\n']) {
    const keyFile = utf8Encode(`${'a1'.repeat(32)}${ending}`);
    assert.deepEqual(await keyFileComponent(keyFile), await sha256(keyFile));
  }
});

test('keyFileComponent: 64 bytes that are not all hex are hashed whole', async () => {
  const keyFile = utf8Encode(`${'a1'.repeat(31)}zz`);
  assert.equal(keyFile.length, 64);
  assert.deepEqual(await keyFileComponent(keyFile), await sha256(keyFile));
});

test('keyFileComponent: non-hex, non-32-byte content falls back to SHA-256 of the raw bytes', async () => {
  const keyFile = utf8Encode('this is not hex and not 32 bytes long');
  const component = await keyFileComponent(keyFile);
  assert.equal(component.length, 32); // SHA-256 digest length
});

test('keyFileComponent: non-ASCII bytes also fall back to SHA-256', async () => {
  const keyFile = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x10, 0x20]); // 0xff is not ASCII
  const component = await keyFileComponent(keyFile);
  assert.equal(component.length, 32);
});

test('keyFileComponent: KeePass 2.x XML key file (hex data, valid checksum) is parsed', async () => {
  const rawKey = new Uint8Array(32).map((_, i) => (i * 3 + 1) & 0xff);
  const hex = Array.from(rawKey, (b) => b.toString(16).padStart(2, '0')).join('');
  const hash = toHex((await sha256(rawKey)).slice(0, 4));
  const xml = `<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data Hash="${hash}">${hex}</Data></Key></KeyFile>`;
  const component = await keyFileComponent(utf8Encode(xml));
  assert.deepEqual(component, rawKey);
});

test('keyFileComponent: KeePass 2.x XML key file with a mismatched checksum is rejected', async () => {
  const rawKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);
  const hex = Array.from(rawKey, (b) => b.toString(16).padStart(2, '0')).join('');
  const xml = `<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data Hash="deadbeef">${hex}</Data></Key></KeyFile>`;
  await assert.rejects(keyFileComponent(utf8Encode(xml)), /checksum mismatch/);
});

test('keyFileComponent: KeePass 2.x XML key file without a Hash attribute skips the checksum check', async () => {
  const rawKey = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
  const hex = Array.from(rawKey, (b) => b.toString(16).padStart(2, '0')).join('');
  const xml = `<KeyFile><Meta><Version>2.0</Version></Meta><Key><Data>${hex}</Data></Key></KeyFile>`;
  const component = await keyFileComponent(utf8Encode(xml));
  assert.deepEqual(component, rawKey);
});

test('keyFileComponent: KeePass 2.x XML key file with whitespace around the Version is parsed', async () => {
  const rawKey = new Uint8Array(32).map((_, i) => (i * 13 + 7) & 0xff);
  const hex = Array.from(rawKey, (b) => b.toString(16).padStart(2, '0')).join('');
  const xml = `<KeyFile><Meta><Version>\n\t\t2.0 \n\t</Version></Meta><Key><Data>${hex}</Data></Key></KeyFile>`;
  const component = await keyFileComponent(utf8Encode(xml));
  assert.deepEqual(component, rawKey);
});

test('keyFileComponent: KeePass 1.x XML key file (base64 data, no Version element) is parsed', async () => {
  const rawKey = new Uint8Array(32).map((_, i) => (i * 5 + 2) & 0xff);
  const xml = `<KeyFile><Key><Data>${toBase64(rawKey)}</Data></Key></KeyFile>`;
  const component = await keyFileComponent(utf8Encode(xml));
  assert.deepEqual(component, rawKey);
});

test('keyFileComponent: an XML-ish key file missing <Data> falls through to the raw-byte checks', async () => {
  // Contains the <KeyFile marker so kx_tryParseXmlKeyFile attempts to parse
  // it, but has no <Data> element, so it must return undefined and let
  // keyFileComponent fall through to its other detection rules.
  const xml = '<KeyFile><Key></Key></KeyFile>'; // no <Data>, and not 32 bytes / hex-64 / etc.
  const component = await keyFileComponent(utf8Encode(xml));
  assert.equal(component.length, 32); // SHA-256 fallback
});

test('credentials keep their own copies, and wipe() zeroes only those, then refuses a key (#145)', async (t) => {
  const password = utf8Encode('correct horse'); // 13 bytes
  const keyFile = new Uint8Array(32).fill(7);
  const credentials = new Credentials({ password, keyFile });
  const before = toHex(await credentials.getCompositeKey());

  password.fill(1); // the caller reuses its own buffers
  keyFile.fill(2);
  assert.equal(toHex(await credentials.getCompositeKey()), before, 'copied at construction');

  // The copies are private, so the zeroing is seen as the fill(0) calls wipe() makes.
  const fills = t.mock.method(Uint8Array.prototype, 'fill');
  credentials.wipe();
  const zeroed = fills.mock.calls
    .filter((call) => call.arguments[0] === 0)
    .map((call) => call.this as Uint8Array);
  fills.mock.restore();
  assert.deepEqual(
    zeroed.map((bytes) => bytes.length),
    [13, 32],
    'its own password and key file copies',
  );
  assert.ok(zeroed.every((bytes) => bytes.every((b) => b === 0)));
  assert.ok(!zeroed.includes(password) && !zeroed.includes(keyFile), "not the caller's");
  assert.deepEqual(password, new Uint8Array(13).fill(1), "the caller's buffers are untouched");
  assert.deepEqual(keyFile, new Uint8Array(32).fill(2));

  // Refused, so a stray save can't seal a database under the all-zero key.
  await assert.rejects(() => credentials.getCompositeKey(), /wiped/);
});

test('wipe() covers a password alone and a key file alone (#145)', async () => {
  const passwordOnly = Credentials.fromPassword('pw');
  passwordOnly.wipe();
  await assert.rejects(() => passwordOnly.getCompositeKey(), /wiped/);
  const keyFileOnly = new Credentials({ keyFile: new Uint8Array(32).fill(4) });
  keyFileOnly.wipe();
  await assert.rejects(() => keyFileOnly.getCompositeKey(), /wiped/);
});
