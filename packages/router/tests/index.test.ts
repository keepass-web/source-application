import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identifyFormat } from '../src/index.ts';

/** Build a valid 8-byte KDBX-family header with the given secondary signature byte. */
function header(secondaryByte: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x9aa2d903, true);
  view.setUint32(4, 0xb54bfb00 | secondaryByte, true);
  return buf;
}

test('identifyFormat rejects a buffer shorter than 8 bytes', () => {
  assert.deepEqual(identifyFormat(new Uint8Array(0)), { kind: 'invalid' });
  assert.deepEqual(identifyFormat(header(0x67).slice(0, 7)), { kind: 'invalid' });
});

test('identifyFormat rejects a file whose first signature does not match', () => {
  const buf = header(0x67);
  new DataView(buf.buffer).setUint32(0, 0, true);
  assert.deepEqual(identifyFormat(buf), { kind: 'invalid' });
});

test('identifyFormat rejects a first-signature match paired with an unrelated second signature', () => {
  const buf = header(0x67);
  new DataView(buf.buffer).setUint32(4, 0, true);
  assert.deepEqual(identifyFormat(buf), { kind: 'invalid' });
});

test('identifyFormat recognizes KDBX 3.1 / 4.x (0x67) and names the implementation that reads it', () => {
  assert.deepEqual(identifyFormat(header(0x67)), {
    kind: 'recognized',
    secondaryByte: 0x67,
    label: 'KDBX 3.1 / 4.x',
    implementation: '0x67.html',
  });
});

test('identifyFormat recognizes KeePass 1.x .kdb (0x65) as not yet supported', () => {
  assert.deepEqual(identifyFormat(header(0x65)), {
    kind: 'recognized',
    secondaryByte: 0x65,
    label: 'KeePass 1.x (.kdb)',
  });
});

test('identifyFormat recognizes a KDBX pre-release (0x66) as not yet supported', () => {
  assert.deepEqual(identifyFormat(header(0x66)), {
    kind: 'recognized',
    secondaryByte: 0x66,
    label: 'KDBX pre-release',
  });
});

test('identifyFormat labels an unrecognized secondary signature byte generically', () => {
  assert.deepEqual(identifyFormat(header(0x99)), {
    kind: 'recognized',
    secondaryByte: 0x99,
    label: 'unknown KDBX variant (secondary signature 0x99)',
  });
});
