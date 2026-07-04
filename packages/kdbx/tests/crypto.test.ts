import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aesKdfTransform, getRandomBytes, sha256 } from '../src/index.ts';

test('getRandomBytes and sha256 produce output of the expected length', async () => {
  assert.equal(getRandomBytes(16).length, 16);
  assert.equal((await sha256(new Uint8Array(4))).length, 32);
});

test('getRandomBytes does not return the same bytes twice', () => {
  // Not a rigorous randomness test — just guards against an accidental
  // all-zeros or otherwise-constant implementation.
  assert.notDeepEqual(getRandomBytes(32), getRandomBytes(32));
});

test('throws a clear error when WebCrypto is unavailable', async () => {
  const original = globalThis.crypto;
  try {
    // Stub out `.subtle` rather than deleting `globalThis.crypto` outright,
    // since the latter may not be configurable in every environment.
    Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
    assert.throws(() => getRandomBytes(1), /WebCrypto.*not available/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  }
  // Confirm the environment was actually restored, not left broken for
  // tests that run after this one.
  assert.equal((await sha256(new Uint8Array(1))).length, 32);
});

test('aesKdfTransform rejects a rounds count above the supported maximum', async () => {
  const key = new Uint8Array(32);
  const seed = new Uint8Array(32);
  await assert.rejects(
    () => aesKdfTransform(key, seed, BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    RangeError,
  );
});
