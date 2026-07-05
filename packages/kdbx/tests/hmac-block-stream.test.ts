import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter } from '../src/bytes.ts';
// Not part of the public barrel (only used internally, by kdbx.ts).
import { readHmacBlockStream, writeHmacBlockStream } from '../src/hmac-block-stream.ts';

test('round-trips a multi-block payload', async () => {
  const hmacBaseKey = new Uint8Array(64).map((_, i) => i);
  const payload = new Uint8Array(2500).map((_, i) => (i * 13 + 5) & 0xff);
  const stream = await writeHmacBlockStream(payload, hmacBaseKey, 1000); // force 3 blocks
  const decoded = await readHmacBlockStream(stream, hmacBaseKey);
  assert.deepEqual(decoded, payload);
});

test('an empty payload round-trips to a single terminating block', async () => {
  const hmacBaseKey = new Uint8Array(64).map((_, i) => i);
  const stream = await writeHmacBlockStream(new Uint8Array(0), hmacBaseKey);
  const decoded = await readHmacBlockStream(stream, hmacBaseKey);
  assert.deepEqual(decoded, new Uint8Array(0));
});

test('rejects a stream with a negative block size', async () => {
  const hmacBaseKey = new Uint8Array(64).map((_, i) => i);
  // The writer never produces a negative size, so hand-craft a stream: a
  // 32-byte (bogus) MAC followed by a size field of -1.
  const writer = new ByteWriter();
  writer.writeBytes(new Uint8Array(32));
  writer.writeI32(-1);
  await assert.rejects(
    () => readHmacBlockStream(writer.toBytes(), hmacBaseKey),
    /invalid HMAC block size/,
  );
});

test('rejects a stream whose block MAC does not match its data', async () => {
  const hmacBaseKey = new Uint8Array(64).map((_, i) => i);
  const stream = await writeHmacBlockStream(new Uint8Array([1, 2, 3]), hmacBaseKey, 10);
  const corrupted = stream.slice();
  // Cast only satisfies noUncheckedIndexedAccess: index 0 is always in range
  // for this real, freshly-written stream.
  corrupted[0] = (corrupted[0] as number) ^ 0xff; // flip a byte inside the stored MAC
  await assert.rejects(
    () => readHmacBlockStream(corrupted, hmacBaseKey),
    /HMAC verification failed/,
  );
});
