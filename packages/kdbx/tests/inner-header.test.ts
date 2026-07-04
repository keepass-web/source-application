import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter } from '../src/bytes.ts';
import { InnerHeaderFieldId, InnerStreamCipher } from '../src/constants.ts';
import { type InnerHeader, readInnerHeader, writeInnerHeader } from '../src/index.ts';

test('round-trips an inner header with binaries', () => {
  const inner: InnerHeader = {
    innerRandomStreamId: InnerStreamCipher.ChaCha20,
    innerRandomStreamKey: new Uint8Array(32).map((_, i) => i),
    binaries: [
      { flags: 0x01, data: new Uint8Array([1, 2, 3]) },
      { flags: 0x00, data: new Uint8Array(0) }, // zero-length binary
    ],
  };
  const encoded = writeInnerHeader(inner);
  const { inner: decoded, xml } = readInnerHeader(
    new Uint8Array([...encoded, ...new Uint8Array([60, 47, 62])]),
  );
  assert.deepEqual(decoded, inner);
  assert.deepEqual(xml, new Uint8Array([60, 47, 62]));
});

test('a zero-length raw Binary field defaults its flags to 0', () => {
  // Hand-build a header with a Binary field whose value is entirely empty
  // (no flags byte at all), to hit the `value[0] ?? 0` fallback branch.
  const writer = new ByteWriter();
  writer.writeU8(InnerHeaderFieldId.InnerRandomStreamId);
  writer.writeI32(4);
  writer.writeBytes(new ByteWriter(4).writeI32(InnerStreamCipher.ChaCha20).toBytes());
  writer.writeU8(InnerHeaderFieldId.InnerRandomStreamKey);
  writer.writeI32(0);
  writer.writeU8(InnerHeaderFieldId.Binary);
  writer.writeI32(0); // zero-length value: no flags byte, no data
  writer.writeU8(InnerHeaderFieldId.EndOfHeader);
  writer.writeI32(0);

  const { inner } = readInnerHeader(writer.toBytes());
  assert.equal(inner.binaries.length, 1);
  assert.equal(inner.binaries[0]?.flags, 0);
  assert.deepEqual(inner.binaries[0]?.data, new Uint8Array(0));
});

test('unrecognized inner header field IDs are skipped', () => {
  const writer = new ByteWriter();
  writer.writeU8(0x7f); // not a recognized InnerHeaderFieldId
  writer.writeI32(3);
  writer.writeBytes(new Uint8Array([9, 9, 9]));
  writer.writeU8(InnerHeaderFieldId.EndOfHeader);
  writer.writeI32(0);

  const { inner, xml } = readInnerHeader(writer.toBytes());
  assert.equal(inner.binaries.length, 0);
  // Defaults are preserved since the unknown field was ignored.
  assert.equal(inner.innerRandomStreamId, InnerStreamCipher.ChaCha20);
  assert.deepEqual(xml, new Uint8Array(0));
});
