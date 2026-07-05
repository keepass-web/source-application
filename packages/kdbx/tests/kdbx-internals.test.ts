import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ByteWriter } from '../src/bytes.ts';
import {
  HEADER_END_MARKER,
  HeaderFieldId,
  KdfParam,
  SIGNATURE_1,
  SIGNATURE_2,
} from '../src/constants.ts';
import { writeHmacBlockStream } from '../src/hmac-block-stream.ts';
import {
  aesCbcEncrypt,
  CipherId,
  Compression,
  Credentials,
  concatBytes,
  createDatabaseDocument,
  createElement,
  getRandomBytes,
  hmacSha256,
  InnerStreamCipher,
  Kdbx,
  KdfId,
  type OuterHeader,
  readOuterHeader,
  serializeXml,
  sha256,
  utf8Encode,
  type VariantDictionary,
  writeInnerHeader,
  writeOuterHeader,
} from '../src/index.ts';
// Not part of the public barrel (only used internally, by kdbx.ts).
import { transformWithKdfParameters } from '../src/kdf.ts';
import { deriveCipherKey, deriveHeaderHmacKey, deriveHmacBaseKey } from '../src/key.ts';

const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;

/** Hand-build a raw KDBX 3.1 outer header, bypassing writeOuterHeader's own
 * required-field checks, so specific fields can be omitted or tampered with. */
function buildRawV3Header(fields: Array<[number, Uint8Array]>): Uint8Array {
  const writer = new ByteWriter();
  writer.writeU32(SIGNATURE_1);
  writer.writeU32(SIGNATURE_2);
  writer.writeU32((3 << 16) | 1);
  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    writer.writeU16(value.length);
    writer.writeBytes(value);
  };
  for (const [id, value] of fields) {
    writeField(id, value);
  }
  writeField(HeaderFieldId.EndOfHeader, HEADER_END_MARKER);
  return writer.toBytes();
}

/** Hand-build a raw KDBX 4.x outer header, bypassing writeOuterHeader's own
 * required-field checks. */
function buildRawV4Header(fields: Array<[number, Uint8Array]>): Uint8Array {
  const writer = new ByteWriter();
  writer.writeU32(SIGNATURE_1);
  writer.writeU32(SIGNATURE_2);
  writer.writeU32(4 << 16);
  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    writer.writeI32(value.length);
    writer.writeBytes(value);
  };
  for (const [id, value] of fields) {
    writeField(id, value);
  }
  writeField(HeaderFieldId.EndOfHeader, HEADER_END_MARKER);
  return writer.toBytes();
}

test('load rejects a header with an unsupported outer cipher', async () => {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    argon2: FAST_ARGON2,
  });
  const saved = await kdbx.save();

  const { header, offset } = readOuterHeader(saved);
  const compositeKey = await credentials.getCompositeKey();
  const transformedKey = await transformWithKdfParameters(
    compositeKey,
    header.kdfParameters as NonNullable<OuterHeader['kdfParameters']>,
  );
  const hmacBaseKey = await deriveHmacBaseKey(header.masterSeed, transformedKey);
  const headerHmacKey = await deriveHeaderHmacKey(hmacBaseKey);

  // Tamper with the cipher ID only; recompute the header SHA/HMAC that cover
  // it so the file still passes integrity checks and reaches cipher dispatch.
  header.cipherId = new Uint8Array(16).fill(0xee);
  const rawHeader = writeOuterHeader(header);
  const headerSha = await sha256(rawHeader);
  const headerHmac = await hmacSha256(headerHmacKey, rawHeader);
  const blockStream = saved.subarray(offset + 64);
  const tampered = concatBytes(rawHeader, headerSha, headerHmac, blockStream);

  await assert.rejects(() => Kdbx.load(tampered, credentials), /unsupported outer cipher/);
});

test('load rejects a KDBX 4 header missing KDF parameters', async () => {
  const bytes = buildRawV4Header([
    [HeaderFieldId.CipherId, new Uint8Array(16)],
    [HeaderFieldId.MasterSeed, new Uint8Array(32)],
    [HeaderFieldId.EncryptionIv, new Uint8Array(12)],
  ]);
  await assert.rejects(
    () => Kdbx.load(bytes, Credentials.fromPassword('pw')),
    /KDBX 4 header is missing KDF parameters/,
  );
});

test('load rejects a KDBX 3.1 header missing transform parameters', async () => {
  const bytes = buildRawV3Header([
    [HeaderFieldId.CipherId, new Uint8Array(16)],
    [HeaderFieldId.MasterSeed, new Uint8Array(32)],
    [HeaderFieldId.EncryptionIv, new Uint8Array(16)],
  ]);
  await assert.rejects(
    () => Kdbx.load(bytes, Credentials.fromPassword('pw')),
    /KDBX 3\.1 header is missing transform parameters/,
  );
});

test('getRootGroup throws when the document has no root group', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), {
    version: 4,
    argon2: FAST_ARGON2,
  });
  kdbx.root = createElement('KeePassFile'); // no <Root><Group> underneath
  assert.throws(() => kdbx.getRootGroup(), /database has no root group/);
});

test('setCredentials changes the credentials used on the next save', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('old'), {
    version: 4,
    argon2: FAST_ARGON2,
  });
  kdbx.setCredentials(Credentials.fromPassword('new'));
  const saved = await kdbx.save();

  await assert.rejects(() => Kdbx.load(saved, Credentials.fromPassword('old')));
  await assert.doesNotReject(() => Kdbx.load(saved, Credentials.fromPassword('new')));
});

test('load rejects a corrupted header (SHA-256 mismatch)', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), {
    version: 4,
    argon2: FAST_ARGON2,
  });
  const saved = await kdbx.save();
  const corrupted = saved.slice();
  // Index 20 is well within the header (real, saved data), so it's always
  // in range; the cast only satisfies noUncheckedIndexedAccess.
  corrupted[20] = (corrupted[20] as number) ^ 0xff;
  await assert.rejects(
    () => Kdbx.load(corrupted, Credentials.fromPassword('pw')),
    /header SHA-256 mismatch/,
  );
});

// --- KDBX 3.1 load-path field checks, using a real ciphertext with a
// hand-tampered header so decryption still succeeds up to the point being
// tested. ---

async function createSavedV3(): Promise<{ header: OuterHeader; ciphertext: Uint8Array }> {
  const credentials = Credentials.fromPassword('pw');
  const kdbx = await Kdbx.create(credentials, { version: 3, aesKdfRounds: 1000n });
  const saved = await kdbx.save();
  const { header, offset } = readOuterHeader(saved);
  return { header, ciphertext: saved.subarray(offset) };
}

function v3FieldsFrom(
  header: OuterHeader,
  overrides: Array<[number, Uint8Array]> = [],
): Array<[number, Uint8Array]> {
  const base: Array<[number, Uint8Array]> = [
    [HeaderFieldId.CipherId, header.cipherId],
    [HeaderFieldId.CompressionFlags, new ByteWriter(4).writeU32(header.compression).toBytes()],
    [HeaderFieldId.MasterSeed, header.masterSeed],
    [HeaderFieldId.TransformSeed, header.transformSeed as Uint8Array],
    [
      HeaderFieldId.TransformRounds,
      new ByteWriter(8).writeU64(header.transformRounds as bigint).toBytes(),
    ],
    [HeaderFieldId.EncryptionIv, header.encryptionIv],
  ];
  return [...base, ...overrides];
}

test('load rejects a KDBX 3.1 header missing stream start bytes', async () => {
  const { header, ciphertext } = await createSavedV3();
  const fields = v3FieldsFrom(header, [
    [HeaderFieldId.ProtectedStreamKey, header.protectedStreamKey as Uint8Array],
    // StreamStartBytes deliberately omitted.
  ]);
  const bytes = concatBytes(buildRawV3Header(fields), ciphertext);
  await assert.rejects(
    () => Kdbx.load(bytes, Credentials.fromPassword('pw')),
    /KDBX 3\.1 header is missing stream start bytes/,
  );
});

test('load rejects a KDBX 3.1 header whose stream start bytes do not match', async () => {
  const { header, ciphertext } = await createSavedV3();
  const fields = v3FieldsFrom(header, [
    [HeaderFieldId.ProtectedStreamKey, header.protectedStreamKey as Uint8Array],
    [HeaderFieldId.StreamStartBytes, new Uint8Array(32).fill(0x7a)], // wrong value
  ]);
  const bytes = concatBytes(buildRawV3Header(fields), ciphertext);
  await assert.rejects(
    () => Kdbx.load(bytes, Credentials.fromPassword('pw')),
    /stream start bytes mismatch/,
  );
});

test('load rejects a KDBX 3.1 header missing the protected stream key', async () => {
  const { header, ciphertext } = await createSavedV3();
  const fields = v3FieldsFrom(header, [
    [HeaderFieldId.StreamStartBytes, header.streamStartBytes as Uint8Array],
    // ProtectedStreamKey deliberately omitted.
  ]);
  const bytes = concatBytes(buildRawV3Header(fields), ciphertext);
  await assert.rejects(
    () => Kdbx.load(bytes, Credentials.fromPassword('pw')),
    /KDBX 3\.1 header is missing the protected stream key/,
  );
});

test('save throws when a KDBX 4 database is missing KDF parameters', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), {
    version: 4,
    argon2: FAST_ARGON2,
  });
  delete kdbx.header.kdfParameters;
  await assert.rejects(() => kdbx.save(), /KDBX 4 database is missing KDF parameters/);
});

test('save throws when a KDBX 3.1 database is missing transform rounds', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), {
    version: 3,
    aesKdfRounds: 1000n,
  });
  delete kdbx.header.transformRounds;
  await assert.rejects(() => kdbx.save(), /KDBX 3\.1 database is missing transform rounds/);
});

test('load defaults a missing KDBX 3.1 inner random stream ID to Salsa20', async () => {
  // #save3 always protects fields with Salsa20, so a reader that (correctly)
  // defaults the absent field to Salsa20 will still be able to parse the file.
  const { header, ciphertext } = await createSavedV3();
  const fields = v3FieldsFrom(header, [
    [HeaderFieldId.ProtectedStreamKey, header.protectedStreamKey as Uint8Array],
    [HeaderFieldId.StreamStartBytes, header.streamStartBytes as Uint8Array],
    // InnerRandomStreamId deliberately omitted.
  ]);
  const bytes = concatBytes(buildRawV3Header(fields), ciphertext);
  const kdbx = await Kdbx.load(bytes, Credentials.fromPassword('pw'));
  assert.ok(kdbx.getRootGroup());
});

test('create defaults to KDBX version 4 when no options are given', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'));
  assert.equal(kdbx.header.version.major, 4);
});

test('create defaults KDBX 3.1 transform rounds when aesKdfRounds is not given', async () => {
  const kdbx = await Kdbx.create(Credentials.fromPassword('pw'), { version: 3 });
  assert.equal(kdbx.header.transformRounds, 60000n);
});

test('#save4 sizes a fresh inner stream key for a non-ChaCha20 inner stream (Salsa20)', async () => {
  // Kdbx.create() always picks ChaCha20 for new KDBX 4 databases, so the only
  // way to get a Kdbx instance whose inner stream is Salsa20 is to load a
  // hand-built file that specifies it in the inner header.
  const credentials = Credentials.fromPassword('pw');
  const compositeKey = await credentials.getCompositeKey();

  const kdfParameters: VariantDictionary = new Map([
    [KdfParam.Uuid, { type: 'bytes', value: KdfId.Aes }],
    [KdfParam.AesSeed, { type: 'bytes', value: getRandomBytes(32) }],
    [KdfParam.AesRounds, { type: 'uint64', value: 1000n }],
  ]);
  const transformedKey = await transformWithKdfParameters(compositeKey, kdfParameters);
  const masterSeed = getRandomBytes(32);
  const cipherKey = await deriveCipherKey(masterSeed, transformedKey);
  const encryptionIv = getRandomBytes(16);

  const header: OuterHeader = {
    version: { major: 4, minor: 0 },
    cipherId: CipherId.Aes256,
    compression: Compression.None,
    masterSeed,
    encryptionIv,
    kdfParameters,
  };

  const innerHeader = {
    innerRandomStreamId: InnerStreamCipher.Salsa20,
    innerRandomStreamKey: getRandomBytes(32),
    binaries: [],
  };
  const root = createDatabaseDocument('Custom');
  const payload = concatBytes(writeInnerHeader(innerHeader), utf8Encode(serializeXml(root)));
  const encrypted = await aesCbcEncrypt(cipherKey, encryptionIv, payload);

  const hmacBaseKey = await deriveHmacBaseKey(masterSeed, transformedKey);
  const rawHeader = writeOuterHeader(header);
  const headerSha = await sha256(rawHeader);
  const headerHmacKey = await deriveHeaderHmacKey(hmacBaseKey);
  const headerHmac = await hmacSha256(headerHmacKey, rawHeader);
  const blockStream = await writeHmacBlockStream(encrypted, hmacBaseKey);
  const fileBytes = concatBytes(rawHeader, headerSha, headerHmac, blockStream);

  const kdbx = await Kdbx.load(fileBytes, credentials);
  // Saving must regenerate a 32-byte (not 64-byte) inner stream key, since the
  // loaded database's inner random stream is Salsa20, not ChaCha20.
  const resaved = await kdbx.save();
  const reloaded = await Kdbx.load(resaved, credentials);
  assert.ok(reloaded.getRootGroup());
});
