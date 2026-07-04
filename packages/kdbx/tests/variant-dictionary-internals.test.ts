import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VariantDictionary } from '../src/index.ts';
import { readVariantDictionary } from '../src/index.ts';
// Not part of the public barrel (only used internally, by kdf.ts).
import { vdRequireBytes, vdRequireInt } from '../src/variant-dictionary.ts';

test('rejects a VariantDictionary with an unsupported major version', () => {
  // version high byte (major) = 2, exceeding the currently-supported major of 1.
  const bad = new Uint8Array([0x00, 0x02, 0x00]);
  assert.throws(() => readVariantDictionary(bad), /unsupported VariantDictionary version/);
});

test('vdRequireBytes throws when the item is missing or the wrong type', () => {
  const dict: VariantDictionary = new Map([['n', { type: 'uint32', value: 1 }]]);
  assert.throws(() => vdRequireBytes(dict, 'missing'), /missing or not a byte array/);
  assert.throws(() => vdRequireBytes(dict, 'n'), /missing or not a byte array/);
  const withBytes: VariantDictionary = new Map([
    ['b', { type: 'bytes', value: new Uint8Array([1, 2]) }],
  ]);
  assert.deepEqual(vdRequireBytes(withBytes, 'b'), new Uint8Array([1, 2]));
});

test('vdRequireInt accepts every integer variant and throws otherwise', () => {
  assert.equal(vdRequireInt(new Map([['n', { type: 'uint32', value: 5 }]]), 'n'), 5n);
  assert.equal(vdRequireInt(new Map([['n', { type: 'int32', value: -5 }]]), 'n'), -5n);
  assert.equal(vdRequireInt(new Map([['n', { type: 'uint64', value: 5n }]]), 'n'), 5n);
  assert.equal(vdRequireInt(new Map([['n', { type: 'int64', value: -5n }]]), 'n'), -5n);
  assert.throws(
    () => vdRequireInt(new Map([['n', { type: 'string', value: 'x' }]]), 'n'),
    /missing or not an integer/,
  );
  assert.throws(() => vdRequireInt(new Map(), 'missing'), /missing or not an integer/);
});
