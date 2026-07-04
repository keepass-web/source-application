import assert from 'node:assert/strict';
import { test } from 'node:test';
import { InnerStreamCipher } from '../src/constants.ts';
// Not part of the public barrel (only used internally, by kdbx.ts/xml.ts).
import { createProtectedStreamCipher } from '../src/protected-stream.ts';

test('creates a working Salsa20 cipher for KDBX 3.1', async () => {
  const cipher = await createProtectedStreamCipher(InnerStreamCipher.Salsa20, new Uint8Array(32));
  const encrypted = cipher.process(new Uint8Array([1, 2, 3, 4]));
  assert.equal(encrypted.length, 4);
});

test('creates a working ChaCha20 cipher for KDBX 4.x', async () => {
  const cipher = await createProtectedStreamCipher(InnerStreamCipher.ChaCha20, new Uint8Array(32));
  const encrypted = cipher.process(new Uint8Array([1, 2, 3, 4]));
  assert.equal(encrypted.length, 4);
});

test('rejects an unsupported inner random stream cipher ID', async () => {
  await assert.rejects(
    () => createProtectedStreamCipher(9999, new Uint8Array(32)),
    /unsupported inner random stream cipher/,
  );
});
