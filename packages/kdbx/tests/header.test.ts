import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter } from '../src/bytes.ts';
import { HEADER_END_MARKER, HeaderFieldId, SIGNATURE_1, SIGNATURE_2 } from '../src/constants.ts';
import {
  type OuterHeader,
  readOuterHeader,
  type VariantDictionary,
  writeOuterHeader,
  writeVariantDictionary,
} from '../src/index.ts';

/** Hand-build a raw outer header buffer, bypassing writeOuterHeader's own
 * required-field checks, so read-side validation and unknown/optional fields
 * can be exercised directly. */
function buildRawHeader(
  major: number,
  minor: number,
  fields: Array<[number, Uint8Array]>,
): Uint8Array {
  const writer = new ByteWriter();
  writer.writeU32(SIGNATURE_1);
  writer.writeU32(SIGNATURE_2);
  writer.writeU32(((major & 0xffff) << 16) | (minor & 0xffff));
  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    if (major >= 4) {
      writer.writeI32(value.length);
    } else {
      writer.writeU16(value.length);
    }
    writer.writeBytes(value);
  };
  for (const [id, value] of fields) {
    writeField(id, value);
  }
  writeField(HeaderFieldId.EndOfHeader, HEADER_END_MARKER);
  return writer.toBytes();
}

const REQUIRED_V4_FIELDS: Array<[number, Uint8Array]> = [
  [HeaderFieldId.CipherId, new Uint8Array(16)],
  [HeaderFieldId.MasterSeed, new Uint8Array(32)],
  [HeaderFieldId.EncryptionIv, new Uint8Array(12)],
];

test('rejects a buffer with a bad signature', () => {
  const bytes = new ByteWriter().writeU32(0).writeU32(0).writeU32(0).toBytes();
  assert.throws(() => readOuterHeader(bytes), /not a KDBX file \(bad signature\)/);
});

test('rejects an unsupported major version', () => {
  const writer = new ByteWriter();
  writer.writeU32(SIGNATURE_1);
  writer.writeU32(SIGNATURE_2);
  writer.writeU32((5 << 16) | 0);
  assert.throws(() => readOuterHeader(writer.toBytes()), /unsupported KDBX major version 5/);
});

test('reads an optional Comment field', () => {
  const bytes = buildRawHeader(4, 0, [
    [HeaderFieldId.Comment, new Uint8Array([1, 2, 3])],
    ...REQUIRED_V4_FIELDS,
  ]);
  const { header } = readOuterHeader(bytes);
  assert.deepEqual(header.comment, new Uint8Array([1, 2, 3]));
});

test('reads an optional PublicCustomData field', () => {
  const publicCustomData: VariantDictionary = new Map([['note', { type: 'string', value: 'hi' }]]);
  const bytes = buildRawHeader(4, 0, [
    ...REQUIRED_V4_FIELDS,
    [HeaderFieldId.PublicCustomData, writeVariantDictionary(publicCustomData)],
  ]);
  const { header } = readOuterHeader(bytes);
  assert.deepEqual(header.publicCustomData, publicCustomData);
});

test('ignores unrecognized header field IDs', () => {
  const bytes = buildRawHeader(4, 0, [
    ...REQUIRED_V4_FIELDS,
    [0x7f, new Uint8Array([9, 9, 9])], // not a recognized HeaderFieldId
  ]);
  const { header } = readOuterHeader(bytes);
  assert.deepEqual(header.cipherId, new Uint8Array(16));
});

test('rejects a header missing the cipher ID', () => {
  const bytes = buildRawHeader(4, 0, [
    [HeaderFieldId.MasterSeed, new Uint8Array(32)],
    [HeaderFieldId.EncryptionIv, new Uint8Array(12)],
  ]);
  assert.throws(() => readOuterHeader(bytes), /missing the cipher ID/);
});

test('rejects a header missing the master seed', () => {
  const bytes = buildRawHeader(4, 0, [
    [HeaderFieldId.CipherId, new Uint8Array(16)],
    [HeaderFieldId.EncryptionIv, new Uint8Array(12)],
  ]);
  assert.throws(() => readOuterHeader(bytes), /missing the master seed/);
});

test('rejects a header missing the encryption IV', () => {
  const bytes = buildRawHeader(4, 0, [
    [HeaderFieldId.CipherId, new Uint8Array(16)],
    [HeaderFieldId.MasterSeed, new Uint8Array(32)],
  ]);
  assert.throws(() => readOuterHeader(bytes), /missing the encryption IV/);
});

const kdfParameters: VariantDictionary = new Map([
  ['$UUID', { type: 'bytes', value: new Uint8Array(16) }],
]);

function v4Header(overrides: Partial<OuterHeader> = {}): OuterHeader {
  return {
    version: { major: 4, minor: 0 },
    cipherId: new Uint8Array(16),
    compression: 0,
    masterSeed: new Uint8Array(32),
    encryptionIv: new Uint8Array(12),
    kdfParameters,
    ...overrides,
  };
}

function v3Header(overrides: Partial<OuterHeader> = {}): OuterHeader {
  return {
    version: { major: 3, minor: 1 },
    cipherId: new Uint8Array(16),
    compression: 0,
    masterSeed: new Uint8Array(32),
    encryptionIv: new Uint8Array(16),
    transformSeed: new Uint8Array(32),
    transformRounds: 6000n,
    protectedStreamKey: new Uint8Array(32),
    streamStartBytes: new Uint8Array(32),
    innerRandomStreamId: 2,
    ...overrides,
  };
}

/** Remove an optional field entirely (as opposed to setting it to
 * `undefined`, which `exactOptionalPropertyTypes` disallows). */
function without<T extends object, K extends keyof T>(value: T, key: K): T {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

test('writeOuterHeader writes an optional Comment field', () => {
  const bytes = writeOuterHeader(v4Header({ comment: new Uint8Array([4, 5, 6]) }));
  const { header } = readOuterHeader(bytes);
  assert.deepEqual(header.comment, new Uint8Array([4, 5, 6]));
});

test('writeOuterHeader rejects a KDBX 4 header without KDF parameters', () => {
  const header = without(v4Header(), 'kdfParameters');
  assert.throws(() => writeOuterHeader(header), /KDBX 4 header requires KDF parameters/);
});

test('writeOuterHeader writes an optional PublicCustomData field', () => {
  const publicCustomData: VariantDictionary = new Map([['x', { type: 'bool', value: true }]]);
  const bytes = writeOuterHeader(v4Header({ publicCustomData }));
  const { header } = readOuterHeader(bytes);
  assert.deepEqual(header.publicCustomData, publicCustomData);
});

test('writeOuterHeader rejects a KDBX 3.1 header without a transform seed/rounds', () => {
  const header = without(v3Header(), 'transformSeed');
  assert.throws(
    () => writeOuterHeader(header),
    /KDBX 3\.1 header requires a transform seed and rounds/,
  );
  const header2 = without(v3Header(), 'transformRounds');
  assert.throws(
    () => writeOuterHeader(header2),
    /KDBX 3\.1 header requires a transform seed and rounds/,
  );
});

test('writeOuterHeader rejects a KDBX 3.1 header without inner-stream key/start bytes', () => {
  const header = without(v3Header(), 'protectedStreamKey');
  assert.throws(
    () => writeOuterHeader(header),
    /KDBX 3\.1 header requires inner-stream key and stream start bytes/,
  );
  const header2 = without(v3Header(), 'streamStartBytes');
  assert.throws(
    () => writeOuterHeader(header2),
    /KDBX 3\.1 header requires inner-stream key and stream start bytes/,
  );
});

test('writeOuterHeader/readOuterHeader round-trips a full KDBX 3.1 header', () => {
  const header = v3Header();
  const { header: decoded } = readOuterHeader(writeOuterHeader(header));
  assert.deepEqual(decoded, header);
});

test('writeOuterHeader defaults a missing KDBX 3.1 inner random stream ID to 0', () => {
  const header = without(v3Header(), 'innerRandomStreamId');
  const { header: decoded } = readOuterHeader(writeOuterHeader(header));
  assert.equal(decoded.innerRandomStreamId, 0);
});
