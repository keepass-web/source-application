import assert from 'node:assert/strict';
import { test } from 'node:test';
// Not part of the public barrel (only used internally, by kdbx.ts).
import { KdfParam } from '../src/constants.ts';
import { KdfId, type VariantDictionary, type VdValue } from '../src/index.ts';
import { transformWithKdfParameters } from '../src/kdf.ts';

// Fast enough to run in a unit test while still exercising the real Argon2 path.
const FAST_ARGON2_PARAMS: Array<[string, VdValue]> = [
  [KdfParam.Argon2Salt, { type: 'bytes', value: new Uint8Array(16) }],
  [KdfParam.Argon2Parallelism, { type: 'uint32', value: 1 }],
  [KdfParam.Argon2Memory, { type: 'uint64', value: 64n * 1024n }],
  [KdfParam.Argon2Iterations, { type: 'uint64', value: 1n }],
];

function argon2Params(extra: typeof FAST_ARGON2_PARAMS = []): VariantDictionary {
  return new Map([
    [KdfParam.Uuid, { type: 'bytes', value: KdfId.Argon2id }],
    ...FAST_ARGON2_PARAMS,
    ...extra,
  ]);
}

test('rejects an unrecognized KDF UUID', async () => {
  const params: VariantDictionary = new Map([
    ['$UUID', { type: 'bytes', value: new Uint8Array(16).fill(0xff) }],
  ]);
  await assert.rejects(
    () => transformWithKdfParameters(new Uint8Array(32), params),
    /unsupported KDF UUID/,
  );
});

test('Argon2 defaults to version 0x13 when no version parameter is given', async () => {
  const withoutVersion = argon2Params();
  const withV13 = argon2Params([[KdfParam.Argon2Version, { type: 'uint32', value: 0x13 }]]);
  const key1 = await transformWithKdfParameters(new Uint8Array(32), withoutVersion);
  const key2 = await transformWithKdfParameters(new Uint8Array(32), withV13);
  assert.deepEqual(key1, key2);
});

test('Argon2 honors an optional secret and associated data', async () => {
  const withSecret = argon2Params([
    [KdfParam.Argon2Secret, { type: 'bytes', value: new Uint8Array([1, 2, 3]) }],
  ]);
  const withAssocData = argon2Params([
    [KdfParam.Argon2AssocData, { type: 'bytes', value: new Uint8Array([4, 5, 6]) }],
  ]);
  const plain = argon2Params();

  const keyWithSecret = await transformWithKdfParameters(new Uint8Array(32), withSecret);
  const keyWithAssocData = await transformWithKdfParameters(new Uint8Array(32), withAssocData);
  const keyPlain = await transformWithKdfParameters(new Uint8Array(32), plain);

  assert.equal(keyWithSecret.length, 32);
  assert.equal(keyWithAssocData.length, 32);
  // Adding a secret or associated data must actually change the derived key.
  assert.notDeepEqual(keyWithSecret, keyPlain);
  assert.notDeepEqual(keyWithAssocData, keyPlain);
});

test('Argon2 ignores a secret/associated-data parameter stored as the wrong type', async () => {
  // Present but not a `bytes` value: exercises kx_optionalBytes's
  // defined-but-wrong-type branch, distinct from the value being absent.
  const params = argon2Params([[KdfParam.Argon2Secret, { type: 'string', value: 'not-bytes' }]]);
  const plain = argon2Params();
  const key1 = await transformWithKdfParameters(new Uint8Array(32), params);
  const key2 = await transformWithKdfParameters(new Uint8Array(32), plain);
  assert.deepEqual(key1, key2); // the malformed secret param was ignored
});
