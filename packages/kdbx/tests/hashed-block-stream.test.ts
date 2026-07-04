import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter } from '../src/bytes.ts';
// Not part of the public barrel (only used internally, by kdbx.ts).
import { readHashedBlockStream, writeHashedBlockStream } from '../src/hashed-block-stream.ts';

test('round-trips a multi-block payload', async () => {
  const payload = new Uint8Array(2500).map((_, i) => (i * 17 + 3) & 0xff);
  const stream = await writeHashedBlockStream(payload, 1000); // force 3 blocks
  const decoded = await readHashedBlockStream(stream);
  assert.deepEqual(decoded, payload);
});

test('rejects a stream with blocks out of order', async () => {
  const stream = await writeHashedBlockStream(new Uint8Array([1, 2, 3]), 10);
  // The first byte of the stream is the little-endian block index (0); bump
  // it to 1 so the reader's expectedIndex check fails immediately.
  const corrupted = stream.slice();
  corrupted[0] = 1;
  await assert.rejects(() => readHashedBlockStream(corrupted), /out of order/);
});

test('rejects a stream whose block hash does not match its data', async () => {
  const stream = await writeHashedBlockStream(new Uint8Array([1, 2, 3]), 10);
  const corrupted = stream.slice();
  // Bytes [4, 36) are the stored SHA-256 hash of the first (only) block;
  // flip one to break the integrity check without changing the block size.
  // (The cast only satisfies noUncheckedIndexedAccess: index 4 is always in
  // range for this real, freshly-written stream.)
  corrupted[4] = (corrupted[4] as number) ^ 0xff;
  await assert.rejects(() => readHashedBlockStream(corrupted), /integrity check failed/);
});

test('an empty payload round-trips to a single terminating block', async () => {
  const stream = await writeHashedBlockStream(new Uint8Array(0));
  // index(4) + hash(32) + size(4) = 40 bytes for the lone terminator.
  assert.equal(stream.length, 40);
  assert.deepEqual(await readHashedBlockStream(stream), new Uint8Array(0));
});

test('a manually-built two-block stream round-trips (sanity check on the wire format)', async () => {
  const w = new ByteWriter();
  const hash1 = await import('../src/crypto.ts').then((m) => m.sha256(new Uint8Array([9, 9])));
  w.writeU32(0);
  w.writeBytes(hash1);
  w.writeU32(2);
  w.writeBytes(new Uint8Array([9, 9]));
  w.writeU32(1); // terminator
  w.writeBytes(new Uint8Array(32));
  w.writeU32(0);
  assert.deepEqual(await readHashedBlockStream(w.toBytes()), new Uint8Array([9, 9]));
});
