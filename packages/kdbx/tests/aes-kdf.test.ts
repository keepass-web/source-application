import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aesCbcEncrypt, aesKdfTransform, concatBytes, sha256, toHex } from '../src/index.ts';

const ZERO_IV = new Uint8Array(16);

/** Reference AES-KDF: encrypt each half `rounds` times with single-block ECB. */
async function referenceAesKdf(
  key: Uint8Array,
  seed: Uint8Array,
  rounds: number,
): Promise<Uint8Array> {
  const ecb = async (block: Uint8Array): Promise<Uint8Array> =>
    (await aesCbcEncrypt(seed, ZERO_IV, block)).slice(0, 16); // CBC single block, IV=0 == ECB
  const transform = async (start: Uint8Array): Promise<Uint8Array> => {
    let value = start;
    for (let i = 0; i < rounds; i += 1) {
      value = await ecb(value);
    }
    return value;
  };
  const left = await transform(key.slice(0, 16));
  const right = await transform(key.slice(16, 32));
  return sha256(concatBytes(left, right));
}

test('aesKdfTransform matches an independent single-block reference', async () => {
  const key = new Uint8Array(32).map((_, i) => (i * 11 + 3) & 0xff);
  const seed = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);
  for (const rounds of [1, 2, 5, 17]) {
    const actual = await aesKdfTransform(key, seed, BigInt(rounds));
    const expected = await referenceAesKdf(key, seed, rounds);
    assert.equal(toHex(actual), toHex(expected), `rounds=${rounds}`);
  }
});

test('aesKdfTransform is deterministic and depends on rounds', async () => {
  const key = new Uint8Array(32).fill(1);
  const seed = new Uint8Array(32).fill(2);
  const a = await aesKdfTransform(key, seed, 10n);
  const b = await aesKdfTransform(key, seed, 10n);
  const c = await aesKdfTransform(key, seed, 11n);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('aesKdfTransform validates input', async () => {
  await assert.rejects(
    () => aesKdfTransform(new Uint8Array(16), new Uint8Array(32), 1n),
    RangeError,
  );
  await assert.rejects(
    () => aesKdfTransform(new Uint8Array(32), new Uint8Array(32), 0n),
    RangeError,
  );
});
