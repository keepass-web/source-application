import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readVariantDictionary,
  type VariantDictionary,
  type VdValue,
  writeVariantDictionary,
} from '../src/index.ts';

test('VariantDictionary round-trips every value type, preserving order', () => {
  const dict: VariantDictionary = new Map<string, VdValue>([
    ['u32', { type: 'uint32', value: 0xdeadbeef }],
    ['u64', { type: 'uint64', value: 0x0102030405060708n }],
    ['bool', { type: 'bool', value: true }],
    ['i32', { type: 'int32', value: -5 }],
    ['i64', { type: 'int64', value: -123456789012345n }],
    ['str', { type: 'string', value: 'héllo' }],
    ['bytes', { type: 'bytes', value: new Uint8Array([1, 2, 3, 4]) }],
  ]);

  const decoded = readVariantDictionary(writeVariantDictionary(dict));
  assert.deepEqual([...decoded.keys()], [...dict.keys()]);
  assert.deepEqual(decoded, dict);
});

test('VariantDictionary encodes the documented version 0x0100', () => {
  const bytes = writeVariantDictionary(new Map());
  assert.equal(bytes[0], 0x00);
  assert.equal(bytes[1], 0x01);
  // version (2) + terminating null (1)
  assert.equal(bytes.length, 3);
  assert.equal(bytes[2], 0x00);
});

test('VariantDictionary rejects unknown value types', () => {
  // version 0x0100, type 0x99, name size 1, name 'x', value size 0, terminator
  const bad = new Uint8Array([
    0x00, 0x01, 0x99, 0x01, 0x00, 0x00, 0x00, 0x78, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  assert.throws(() => readVariantDictionary(bad));
});
