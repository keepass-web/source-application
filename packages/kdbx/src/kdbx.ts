/**
 * High-level KDBX database: parsing (`load`), serialization (`save`), and
 * creation (`create`) for KDBX 3.1 and 4.x.
 *
 * The flow mirrors the specification's overall structure:
 *   load — read outer header, verify header SHA-256/HMAC (4.x) → de-chunk →
 *          decrypt → decompress → read inner header (4.x) → parse XML →
 *          unprotect fields.
 *   save — protect fields → serialize XML → prepend inner header (4.x) →
 *          compress → encrypt → chunk → prepend header + SHA-256 + HMAC (4.x).
 */

import { ChaCha20 } from '../../../build/packages/chacha20/src/index.js';
import {
  bytesEqual,
  bytesEqualConstantTime,
  concatBytes,
  utf8Decode,
  utf8Encode,
} from './bytes.ts';
import {
  Argon2Version,
  CipherId,
  Compression,
  InnerStreamCipher,
  KdfId,
  KdfParam,
} from './constants.ts';
import type { Credentials } from './credentials.ts';
import {
  aesCbcDecrypt,
  aesCbcEncrypt,
  getRandomBytes,
  gunzip,
  gzip,
  hmacSha256,
  sha256,
} from './crypto.ts';
import { readHashedBlockStream, writeHashedBlockStream } from './hashed-block-stream.ts';
import { type OuterHeader, readOuterHeader, writeOuterHeader } from './header.ts';
import { readHmacBlockStream, writeHmacBlockStream } from './hmac-block-stream.ts';
import {
  type InnerBinary,
  type InnerHeader,
  readInnerHeader,
  writeInnerHeader,
} from './inner-header.ts';
import { aesKdf, transformWithKdfParameters } from './kdf.ts';
import { deriveCipherKey, deriveHeaderHmacKey, deriveHmacBaseKey } from './key.ts';
import {
  applyInboundProtection,
  applyOutboundProtection,
  cloneElement,
  createDatabaseDocument,
  getAttribute,
  getChild,
  getChildren,
  setAttribute,
} from './model.ts';
import { createProtectedStreamCipher } from './protected-stream.ts';
import type { VariantDictionary, VdValue } from './variant-dictionary.ts';
import { parseXml, serializeXml, type XmlElement } from './xml.ts';

/** Outer cipher choices. */
export type KdbxCipher = 'aes' | 'chacha20';
/** Key derivation function choices (KDBX 4.x). */
export type KdbxKdf = 'argon2id' | 'argon2d' | 'aes';

/** Options for {@link Kdbx.create}. */
export interface KdbxCreateOptions {
  databaseName?: string;
  /** Format version family: 3 (KDBX 3.1) or 4 (KDBX 4.x). Default 4. */
  version?: 3 | 4;
  /** Outer cipher. Default `chacha20` for v4; AES is forced for v3. */
  cipher?: KdbxCipher;
  /** KDF. Default `argon2id` for v4; AES-KDF is forced for v3. */
  kdf?: KdbxKdf;
  /** GZip-compress the payload. Default true. */
  compression?: boolean;
  /** Argon2 tuning (KDBX 4.x). */
  argon2?: {
    memoryBytes?: bigint;
    iterations?: bigint;
    parallelism?: number;
    version?: number;
  };
  /** AES-KDF rounds. */
  aesKdfRounds?: bigint;
}

const KX_DEFAULT_ARGON2 = {
  memoryBytes: 16n * 1024n * 1024n,
  iterations: 3n,
  parallelism: 1,
  version: Argon2Version.V13,
} as const;
const KX_DEFAULT_AES_KDF_ROUNDS = 60000n;

function kx_bytes(value: Uint8Array): VdValue {
  return { type: 'bytes', value };
}

/**
 * Classify a cipher ID, or throw if it names neither outer cipher this
 * package supports. This is the single point where "supported outer cipher"
 * is defined; `kx_ivLengthFor`/`kx_encryptPayload`/`kx_decryptPayload` all
 * dispatch through it rather than each re-checking the same two IDs, so
 * there's exactly one "unsupported outer cipher" error site instead of three
 * copies (which, in kx_encryptPayload's case, could never actually be
 * reached: the only caller, `#save4`, always calls `kx_ivLengthFor` on the
 * same `cipherId` first and would already have thrown by then).
 */
function kx_cipherKind(cipherId: Uint8Array): 'aes' | 'chacha20' {
  if (bytesEqual(cipherId, CipherId.Aes256)) {
    return 'aes';
  }
  if (bytesEqual(cipherId, CipherId.ChaCha20)) {
    return 'chacha20';
  }
  throw new Error('unsupported outer cipher');
}

function kx_ivLengthFor(cipherId: Uint8Array): number {
  return kx_cipherKind(cipherId) === 'chacha20' ? 12 : 16;
}

async function kx_encryptPayload(
  cipherId: Uint8Array,
  cipherKey: Uint8Array,
  iv: Uint8Array,
  payload: Uint8Array,
): Promise<Uint8Array> {
  return kx_cipherKind(cipherId) === 'aes'
    ? aesCbcEncrypt(cipherKey, iv, payload)
    : new ChaCha20(cipherKey, iv).encrypt(payload);
}

async function kx_decryptPayload(
  cipherId: Uint8Array,
  cipherKey: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  return kx_cipherKind(cipherId) === 'aes'
    ? aesCbcDecrypt(cipherKey, iv, data)
    : new ChaCha20(cipherKey, iv).decrypt(data);
}

/** Transform the composite key according to the header's KDF settings. */
async function kx_transformKey(header: OuterHeader, compositeKey: Uint8Array): Promise<Uint8Array> {
  if (header.version.major >= 4) {
    if (!header.kdfParameters) {
      throw new Error('KDBX 4 header is missing KDF parameters');
    }
    return transformWithKdfParameters(compositeKey, header.kdfParameters);
  }
  if (!header.transformSeed || header.transformRounds === undefined) {
    throw new Error('KDBX 3.1 header is missing transform parameters');
  }
  return aesKdf(compositeKey, header.transformSeed, header.transformRounds);
}

/** An in-memory KDBX database. */
export class Kdbx {
  /** The outer header. Random fields (seeds, IVs, salts) are regenerated on save. */
  header: OuterHeader;
  /** The `<KeePassFile>` document root, with protected fields held as plaintext. */
  root: XmlElement;
  /** Binary attachments (KDBX 4.x inner header). */
  binaries: InnerBinary[];

  #credentials: Credentials;
  #innerStreamId: number;
  /** Inner random stream key (KDBX 4.x); for 3.1 the protected-stream key is in the header. */
  #innerStreamKey: Uint8Array;

  private constructor(init: {
    header: OuterHeader;
    root: XmlElement;
    binaries: InnerBinary[];
    credentials: Credentials;
    innerStreamId: number;
    innerStreamKey: Uint8Array;
  }) {
    this.header = init.header;
    this.root = init.root;
    this.binaries = init.binaries;
    this.#credentials = init.credentials;
    this.#innerStreamId = init.innerStreamId;
    this.#innerStreamKey = init.innerStreamKey;
  }

  /** The root `<Group>` element under `<Root>`. */
  getRootGroup(): XmlElement {
    const rootElement = getChild(this.root, 'Root');
    const group = rootElement ? getChild(rootElement, 'Group') : undefined;
    if (!group) {
      throw new Error('database has no root group');
    }
    return group;
  }

  /** Replace the credentials used when the database is next saved. */
  setCredentials(credentials: Credentials): void {
    this.#credentials = credentials;
  }

  /**
   * Add a binary attachment to the pool, reusing an existing identical one
   * (by content) rather than growing the pool without bound. Returns the
   * pool index — reference it from an entry via a
   * `<Binary><Value Ref="N"/></Binary>` child (see model.ts's
   * addEntryAttachment). KDBX 4.x only: 3.1 stores binaries differently
   * (Meta/Binaries in the XML), which this library doesn't support.
   */
  addBinary(data: Uint8Array): number {
    for (let i = 0; i < this.binaries.length; i++) {
      // i < this.binaries.length, so this index is always populated; the
      // cast only satisfies noUncheckedIndexedAccess.
      if (bytesEqual((this.binaries[i] as InnerBinary).data, data)) return i;
    }
    this.binaries.push({ flags: 0, data });
    return this.binaries.length - 1;
  }

  /** The bytes for a pool index, or undefined if out of range. */
  getBinaryData(ref: number): Uint8Array | undefined {
    return this.binaries[ref]?.data;
  }

  /**
   * Remove any binary pool entries no longer referenced by any entry's
   * `<Binary>` child, and remap the survivors' Ref indices to stay
   * contiguous. Called on every save; a no-op for KDBX 3.1, whose pool is
   * always empty.
   */
  #pruneUnreferencedBinaries(): void {
    if (this.binaries.length === 0) return;

    const refs: Array<{ valueEl: XmlElement; oldRef: number }> = [];
    const walk = (group: XmlElement): void => {
      for (const entry of getChildren(group, 'Entry')) {
        for (const binaryEl of getChildren(entry, 'Binary')) {
          const valueEl = getChild(binaryEl, 'Value');
          const refText = valueEl && getAttribute(valueEl, 'Ref');
          if (valueEl && refText !== undefined) {
            refs.push({ valueEl, oldRef: Number.parseInt(refText, 10) });
          }
        }
      }
      for (const sub of getChildren(group, 'Group')) walk(sub);
    };
    walk(this.getRootGroup());

    const remap = new Map<number, number>();
    const kept: InnerBinary[] = [];
    for (const { oldRef } of refs) {
      if (remap.has(oldRef)) continue;
      const binary = this.binaries[oldRef];
      if (!binary) continue; // stale/out-of-range Ref: leave it be, drop below
      remap.set(oldRef, kept.length);
      kept.push(binary);
    }

    for (const { valueEl, oldRef } of refs) {
      const newRef = remap.get(oldRef);
      if (newRef !== undefined) setAttribute(valueEl, 'Ref', String(newRef));
    }

    this.binaries = kept;
  }

  /** Parse a KDBX database from bytes. */
  static async load(data: Uint8Array, credentials: Credentials): Promise<Kdbx> {
    const { header, rawHeader, offset } = readOuterHeader(data);
    const compositeKey = await credentials.getCompositeKey();
    const transformedKey = await kx_transformKey(header, compositeKey);
    const cipherKey = await deriveCipherKey(header.masterSeed, transformedKey);

    if (header.version.major >= 4) {
      return Kdbx.#load4(data, offset, header, rawHeader, transformedKey, cipherKey, credentials);
    }
    return Kdbx.#load3(data, offset, header, cipherKey, credentials);
  }

  static async #load4(
    data: Uint8Array,
    offset: number,
    header: OuterHeader,
    rawHeader: Uint8Array,
    transformedKey: Uint8Array,
    cipherKey: Uint8Array,
    credentials: Credentials,
  ): Promise<Kdbx> {
    const storedHeaderSha = data.subarray(offset, offset + 32);
    const storedHeaderHmac = data.subarray(offset + 32, offset + 64);
    const blockStream = data.subarray(offset + 64);

    if (!bytesEqual(await sha256(rawHeader), storedHeaderSha)) {
      throw new Error('header SHA-256 mismatch (corrupt file)');
    }
    const hmacBaseKey = await deriveHmacBaseKey(header.masterSeed, transformedKey);
    const headerHmacKey = await deriveHeaderHmacKey(hmacBaseKey);
    if (!bytesEqualConstantTime(await hmacSha256(headerHmacKey, rawHeader), storedHeaderHmac)) {
      throw new Error('header HMAC mismatch (wrong credentials or corrupt file)');
    }

    const encrypted = await readHmacBlockStream(blockStream, hmacBaseKey);
    let payload = await kx_decryptPayload(
      header.cipherId,
      cipherKey,
      header.encryptionIv,
      encrypted,
    );
    if (header.compression === Compression.GZip) {
      payload = await gunzip(payload);
    }

    const { inner, xml } = readInnerHeader(payload);
    const root = parseXml(utf8Decode(xml));
    const cipher = await createProtectedStreamCipher(
      inner.innerRandomStreamId,
      inner.innerRandomStreamKey,
    );
    applyInboundProtection(root, cipher);

    return new Kdbx({
      header,
      root,
      binaries: inner.binaries,
      credentials,
      innerStreamId: inner.innerRandomStreamId,
      innerStreamKey: inner.innerRandomStreamKey,
    });
  }

  static async #load3(
    data: Uint8Array,
    offset: number,
    header: OuterHeader,
    cipherKey: Uint8Array,
    credentials: Credentials,
  ): Promise<Kdbx> {
    const ciphertext = data.subarray(offset);
    const plaintext = await aesCbcDecrypt(cipherKey, header.encryptionIv, ciphertext);

    if (!header.streamStartBytes) {
      throw new Error('KDBX 3.1 header is missing stream start bytes');
    }
    if (!bytesEqual(plaintext.subarray(0, 32), header.streamStartBytes)) {
      throw new Error('stream start bytes mismatch (wrong credentials or corrupt file)');
    }

    let payload = await readHashedBlockStream(plaintext.subarray(32));
    if (header.compression === Compression.GZip) {
      payload = await gunzip(payload);
    }

    const root = parseXml(utf8Decode(payload));
    if (!header.protectedStreamKey) {
      throw new Error('KDBX 3.1 header is missing the protected stream key');
    }
    const streamId = header.innerRandomStreamId ?? InnerStreamCipher.Salsa20;
    const cipher = await createProtectedStreamCipher(streamId, header.protectedStreamKey);
    applyInboundProtection(root, cipher);

    return new Kdbx({
      header,
      root,
      binaries: [],
      credentials,
      innerStreamId: streamId,
      innerStreamKey: header.protectedStreamKey,
    });
  }

  /** Serialize the database to KDBX bytes (regenerating all random material). */
  async save(): Promise<Uint8Array> {
    return this.header.version.major >= 4 ? this.#save4() : this.#save3();
  }

  async #save4(): Promise<Uint8Array> {
    this.#pruneUnreferencedBinaries();

    const header = this.header;
    header.masterSeed = getRandomBytes(32);
    header.encryptionIv = getRandomBytes(kx_ivLengthFor(header.cipherId));
    if (!header.kdfParameters) {
      throw new Error('KDBX 4 database is missing KDF parameters');
    }
    header.kdfParameters.set(KdfParam.AesSeed, kx_bytes(getRandomBytes(32)));

    // Fresh inner random stream key (64 bytes for ChaCha20, 32 for Salsa20).
    this.#innerStreamKey = getRandomBytes(
      this.#innerStreamId === InnerStreamCipher.ChaCha20 ? 64 : 32,
    );
    const innerHeader: InnerHeader = {
      innerRandomStreamId: this.#innerStreamId,
      innerRandomStreamKey: this.#innerStreamKey,
      binaries: this.binaries,
    };

    const cipher = await createProtectedStreamCipher(this.#innerStreamId, this.#innerStreamKey);
    const clonedRoot = cloneElement(this.root);
    applyOutboundProtection(clonedRoot, cipher);
    const xmlBytes = utf8Encode(serializeXml(clonedRoot));

    let payload = concatBytes(writeInnerHeader(innerHeader), xmlBytes);
    if (header.compression === Compression.GZip) {
      payload = await gzip(payload);
    }

    const compositeKey = await this.#credentials.getCompositeKey();
    const transformedKey = await transformWithKdfParameters(compositeKey, header.kdfParameters);
    const cipherKey = await deriveCipherKey(header.masterSeed, transformedKey);
    const encrypted = await kx_encryptPayload(
      header.cipherId,
      cipherKey,
      header.encryptionIv,
      payload,
    );

    const hmacBaseKey = await deriveHmacBaseKey(header.masterSeed, transformedKey);
    const rawHeader = writeOuterHeader(header);
    const headerSha = await sha256(rawHeader);
    const headerHmacKey = await deriveHeaderHmacKey(hmacBaseKey);
    const headerHmac = await hmacSha256(headerHmacKey, rawHeader);
    const blockStream = await writeHmacBlockStream(encrypted, hmacBaseKey);

    return concatBytes(rawHeader, headerSha, headerHmac, blockStream);
  }

  async #save3(): Promise<Uint8Array> {
    const header = this.header;
    header.masterSeed = getRandomBytes(32);
    header.transformSeed = getRandomBytes(32);
    header.encryptionIv = getRandomBytes(16);
    header.protectedStreamKey = getRandomBytes(32);
    header.streamStartBytes = getRandomBytes(32);
    header.innerRandomStreamId = InnerStreamCipher.Salsa20;
    this.#innerStreamId = InnerStreamCipher.Salsa20;
    this.#innerStreamKey = header.protectedStreamKey;

    const cipher = await createProtectedStreamCipher(
      InnerStreamCipher.Salsa20,
      header.protectedStreamKey,
    );
    const clonedRoot = cloneElement(this.root);
    applyOutboundProtection(clonedRoot, cipher);
    let xmlBytes = utf8Encode(serializeXml(clonedRoot));
    if (header.compression === Compression.GZip) {
      xmlBytes = await gzip(xmlBytes);
    }

    const hashedStream = await writeHashedBlockStream(xmlBytes);
    const plaintext = concatBytes(header.streamStartBytes, hashedStream);

    if (header.transformRounds === undefined) {
      throw new Error('KDBX 3.1 database is missing transform rounds');
    }
    const compositeKey = await this.#credentials.getCompositeKey();
    const transformedKey = await aesKdf(compositeKey, header.transformSeed, header.transformRounds);
    const cipherKey = await deriveCipherKey(header.masterSeed, transformedKey);
    const encrypted = await aesCbcEncrypt(cipherKey, header.encryptionIv, plaintext);

    const rawHeader = writeOuterHeader(header);
    return concatBytes(rawHeader, encrypted);
  }

  /** Create a new, empty database with the given credentials. */
  static async create(credentials: Credentials, options: KdbxCreateOptions = {}): Promise<Kdbx> {
    const version = options.version ?? 4;
    const databaseName = options.databaseName ?? 'Database';
    const compression = options.compression ?? true;
    const root = createDatabaseDocument(databaseName);

    if (version === 3) {
      const protectedStreamKey = getRandomBytes(32);
      const header: OuterHeader = {
        version: { major: 3, minor: 1 },
        cipherId: CipherId.Aes256,
        compression: compression ? Compression.GZip : Compression.None,
        masterSeed: getRandomBytes(32),
        transformSeed: getRandomBytes(32),
        transformRounds: options.aesKdfRounds ?? KX_DEFAULT_AES_KDF_ROUNDS,
        encryptionIv: getRandomBytes(16),
        protectedStreamKey,
        streamStartBytes: getRandomBytes(32),
        innerRandomStreamId: InnerStreamCipher.Salsa20,
      };
      return new Kdbx({
        header,
        root,
        binaries: [],
        credentials,
        innerStreamId: InnerStreamCipher.Salsa20,
        innerStreamKey: protectedStreamKey,
      });
    }

    const cipher = options.cipher ?? 'chacha20';
    const cipherId = cipher === 'aes' ? CipherId.Aes256 : CipherId.ChaCha20;
    const header: OuterHeader = {
      version: { major: 4, minor: 0 },
      cipherId,
      compression: compression ? Compression.GZip : Compression.None,
      masterSeed: getRandomBytes(32),
      encryptionIv: getRandomBytes(kx_ivLengthFor(cipherId)),
      kdfParameters: kx_buildKdfParameters(options),
    };
    return new Kdbx({
      header,
      root,
      binaries: [],
      credentials,
      innerStreamId: InnerStreamCipher.ChaCha20,
      innerStreamKey: getRandomBytes(64),
    });
  }
}

function kx_buildKdfParameters(options: KdbxCreateOptions): VariantDictionary {
  const kdf = options.kdf ?? 'argon2id';
  const params: VariantDictionary = new Map();
  if (kdf === 'aes') {
    params.set(KdfParam.Uuid, kx_bytes(KdfId.Aes));
    params.set(KdfParam.AesSeed, kx_bytes(getRandomBytes(32)));
    params.set(KdfParam.AesRounds, {
      type: 'uint64',
      value: options.aesKdfRounds ?? KX_DEFAULT_AES_KDF_ROUNDS,
    });
    return params;
  }

  const argon2 = { ...KX_DEFAULT_ARGON2, ...options.argon2 };
  params.set(KdfParam.Uuid, kx_bytes(kdf === 'argon2d' ? KdfId.Argon2d : KdfId.Argon2id));
  params.set(KdfParam.Argon2Salt, kx_bytes(getRandomBytes(32)));
  params.set(KdfParam.Argon2Version, { type: 'uint32', value: argon2.version });
  params.set(KdfParam.Argon2Memory, { type: 'uint64', value: argon2.memoryBytes });
  params.set(KdfParam.Argon2Iterations, { type: 'uint64', value: argon2.iterations });
  params.set(KdfParam.Argon2Parallelism, { type: 'uint32', value: argon2.parallelism });
  return params;
}
