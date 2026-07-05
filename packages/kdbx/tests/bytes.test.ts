import assert from 'node:assert/strict';
import { test } from 'node:test';
// Not part of the public barrel (only used internally, by hmac-block-stream.ts).
import { bytesEqualConstantTime } from '../src/bytes.ts';
import {
  ByteReader,
  ByteWriter,
  bytesEqual,
  concatBytes,
  fromBase64,
  fromHex,
  toBase64,
  toHex,
  utf8Decode,
  utf8Encode,
} from '../src/index.ts';

test('hex round-trips', () => {
  const bytes = new Uint8Array([0x00, 0x01, 0x7f, 0x80, 0xff]);
  assert.equal(toHex(bytes), '00017f80ff');
  assert.deepEqual(fromHex('00017F80FF'), bytes);
});

test('base64 matches known vectors and round-trips', () => {
  assert.equal(toBase64(utf8Encode('')), '');
  assert.equal(toBase64(utf8Encode('f')), 'Zg==');
  assert.equal(toBase64(utf8Encode('fo')), 'Zm8=');
  assert.equal(toBase64(utf8Encode('foo')), 'Zm9v');
  assert.equal(toBase64(utf8Encode('foob')), 'Zm9vYg==');
  assert.equal(toBase64(utf8Encode('fooba')), 'Zm9vYmE=');
  assert.equal(toBase64(utf8Encode('foobar')), 'Zm9vYmFy');
  for (const text of ['', 'a', 'ab', 'abc', 'hello world', 'KDBX ❤ unicode']) {
    assert.equal(utf8Decode(fromBase64(toBase64(utf8Encode(text)))), text);
  }
});

test('base64 decodes a 32-byte key with padding', () => {
  const key = new Uint8Array(32).map((_, i) => i * 7);
  assert.deepEqual(fromBase64(toBase64(key)), key);
});

test('ByteWriter/ByteReader round-trip little-endian integers', () => {
  const writer = new ByteWriter();
  writer.writeU8(0x12);
  writer.writeU16(0x3456);
  writer.writeU32(0x789abcde);
  writer.writeI32(-2);
  writer.writeU64(0x0102030405060708n);
  writer.writeI64(-3n);
  writer.writeBytes(new Uint8Array([0xaa, 0xbb]));
  const bytes = writer.toBytes();

  const reader = new ByteReader(bytes);
  assert.equal(reader.readU8(), 0x12);
  assert.equal(reader.readU16(), 0x3456);
  assert.equal(reader.readU32(), 0x789abcde);
  assert.equal(reader.readI32(), -2);
  assert.equal(reader.readU64(), 0x0102030405060708n);
  assert.equal(reader.readI64(), -3n);
  assert.deepEqual(reader.readBytes(2), new Uint8Array([0xaa, 0xbb]));
  assert.equal(reader.remaining, 0);
});

test('little-endian byte order is correct', () => {
  assert.deepEqual(
    new ByteWriter().writeU32(0x12345678).toBytes(),
    new Uint8Array([0x78, 0x56, 0x34, 0x12]),
  );
});

test('ByteReader throws past the end', () => {
  assert.throws(() => new ByteReader(new Uint8Array(2)).readU32(), RangeError);
});

test('concatBytes and bytesEqual', () => {
  assert.deepEqual(
    concatBytes(new Uint8Array([1]), new Uint8Array([2, 3])),
    new Uint8Array([1, 2, 3]),
  );
  assert.ok(bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2])));
  assert.ok(!bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3])));
  assert.ok(!bytesEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])));
});

test('bytesEqualConstantTime matches bytesEqual for equal-length inputs, and rejects length mismatches', () => {
  assert.ok(bytesEqualConstantTime(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])));
  assert.ok(!bytesEqualConstantTime(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])));
  assert.ok(!bytesEqualConstantTime(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])));
});

test('fromHex rejects malformed input', () => {
  assert.throws(() => fromHex('abc'), /even number of digits/); // odd length
  assert.throws(() => fromHex('zz'), /invalid hex digit/);
});

test('fromBase64 rejects an invalid character', () => {
  assert.throws(() => fromBase64('not-valid-base64!'), /invalid base64 character/);
  // A char code past the 256-entry lookup table (unlike '!', which is in
  // range but simply isn't a base64 character) exercises the lookup's own
  // out-of-range fallback rather than one of its explicit -1 fill entries.
  assert.throws(() => fromBase64('abc❤'), /invalid base64 character/);
});

test('ByteWriter exposes its current length', () => {
  const writer = new ByteWriter();
  assert.equal(writer.length, 0);
  writer.writeU32(1);
  assert.equal(writer.length, 4);
});

test('ByteWriter grows its buffer past a single doubling for a large write', () => {
  // Default initial capacity is 256 bytes; a single write past double that
  // forces #ensure's capacity-doubling loop to run more than once.
  const data = new Uint8Array(1000).map((_, i) => i & 0xff);
  const writer = new ByteWriter();
  writer.writeBytes(data);
  assert.equal(writer.length, 1000);
  assert.deepEqual(writer.toBytes(), data);
});
