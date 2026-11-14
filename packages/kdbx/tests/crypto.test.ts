import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  aesKdfTransform,
  getRandomBytes,
  sha256,
} from '../src/index.ts';

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

test('aesCbcDecrypt reports bad padding with a message the UI can show', async () => {
  // A wrong key still yields valid PKCS#7 padding about 1 time in 256, so the
  // wrong-password load tests can't be relied on to reach this path (#187). The first
  // ciphertext block of a zero block, decrypted alone under the same key and IV,
  // comes back as zeros, and a final 0x00 is never valid padding.
  const key = new Uint8Array(32);
  const iv = new Uint8Array(16);
  const block = (await aesCbcEncrypt(key, iv, new Uint8Array(16))).slice(0, 16);
  await assert.rejects(() => aesCbcDecrypt(key, iv, block), /wrong credentials or corrupt file/);
});

test('aesKdfTransform rejects a rounds count above the supported maximum', async () => {
  const key = new Uint8Array(32);
  const seed = new Uint8Array(32);
  await assert.rejects(
    () => aesKdfTransform(key, seed, BigInt(Number.MAX_SAFE_INTEGER) + 1n),
    RangeError,
  );
});
