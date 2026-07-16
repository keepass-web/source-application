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
  const keyFile = utf8Encode(`${hex}\r\n`); // trailing CR/LF must be trimmed
  const component = await keyFileComponent(keyFile);
  assert.equal(component.length, 32);
  assert.equal(component[0], 0xa1);
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

test('keyFileComponent: a disallowed control byte also falls back to SHA-256', async () => {
  // 0x01 (SOH) is below 0x20 and not tab/LF/CR, so it fails the ASCII check
  // by a different branch than a byte above 0x7e.
  const keyFile = new Uint8Array([0x41, 0x01, 0x42, 0x43, 0x44, 0x45]);
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
