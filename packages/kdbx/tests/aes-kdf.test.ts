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

/** Reference AES-KDF in one CBC call over all `rounds` zero blocks: memory
grows with rounds, but it is cheap enough to check the chunked version at
round counts that span several of its 65,536-round chunks. */
async function oneShotAesKdf(
  key: Uint8Array,
  seed: Uint8Array,
  rounds: number,
): Promise<Uint8Array> {
  const transform = async (iv: Uint8Array): Promise<Uint8Array> =>
    (await aesCbcEncrypt(seed, iv, new Uint8Array(16 * rounds))).slice(
      16 * (rounds - 1),
      16 * rounds,
    );
  return sha256(concatBytes(await transform(key.slice(0, 16)), await transform(key.slice(16, 32))));
}

test('aesKdfTransform matches a single CBC pass across chunk boundaries', async () => {
  const key = new Uint8Array(32).map((_, i) => (i * 13 + 5) & 0xff);
  const seed = new Uint8Array(32).map((_, i) => (i * 3 + 9) & 0xff);
  // An exact multiple of the chunk size, and three full chunks plus a remainder.
  for (const rounds of [131_072, 200_003]) {
    const actual = await aesKdfTransform(key, seed, BigInt(rounds));
    const expected = await oneShotAesKdf(key, seed, rounds);
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

test('aesKdfTransform rejects a rounds count above the sanity ceiling without attempting it', async () => {
  // rounds comes straight from a file's own (not-yet-authenticated) header;
  // this must reject immediately rather than actually attempting anywhere
  // near this many AES rounds, or the test would never finish either.
  const key = new Uint8Array(32);
  const seed = new Uint8Array(32);
  await assert.rejects(
    () => aesKdfTransform(key, seed, 1_000_000_001n),
    /rounds.*exceed the maximum/,
  );
});
