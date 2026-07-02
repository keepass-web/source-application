/**
 * The outer (unencrypted) KDBX header: signatures, format version, and the
 * type-length-value fields that describe how to decrypt the payload.
 *
 * KDBX 3.1 and 4.x share the field IDs but differ in two ways handled here:
 *   - the field length is a UInt16 in 3.1 and an Int32 in 4.x;
 *   - 3.1 keeps KDF settings and the inner-stream key/ID in the outer header,
 *     whereas 4.x moves the KDF settings into a VariantDictionary and the
 *     inner-stream key/ID into the (encrypted) inner header.
 */

import { ByteReader, ByteWriter } from './bytes.ts';
import {
  Compression,
  HEADER_END_MARKER,
  HeaderFieldId,
  SIGNATURE_1,
  SIGNATURE_2,
} from './constants.ts';
import {
  readVariantDictionary,
  type VariantDictionary,
  writeVariantDictionary,
} from './variant-dictionary.ts';

/** Parsed KDBX format version. */
export interface KdbxVersion {
  major: number;
  minor: number;
}

/** A decoded outer header. Fields that do not apply to a version are absent. */
export interface OuterHeader {
  version: KdbxVersion;
  cipherId: Uint8Array;
  compression: number;
  masterSeed: Uint8Array;
  encryptionIv: Uint8Array;
  comment?: Uint8Array;
  // KDBX 3.1 only:
  transformSeed?: Uint8Array;
  transformRounds?: bigint;
  protectedStreamKey?: Uint8Array;
  streamStartBytes?: Uint8Array;
  innerRandomStreamId?: number;
  // KDBX 4.x only:
  kdfParameters?: VariantDictionary;
  publicCustomData?: VariantDictionary;
}

/** Result of reading the outer header from a buffer. */
export interface ParsedOuterHeader {
  header: OuterHeader;
  /** Exact header bytes (signatures through end-of-header), for hashing/HMAC. */
  rawHeader: Uint8Array;
  /** Offset in the source buffer at which the post-header data begins. */
  offset: number;
}

function kx_isKdbx4(major: number): boolean {
  return major >= 4;
}

/** Parse the outer header from the start of a KDBX buffer. */
export function readOuterHeader(data: Uint8Array): ParsedOuterHeader {
  const reader = new ByteReader(data);
  if (reader.readU32() !== SIGNATURE_1 || reader.readU32() !== SIGNATURE_2) {
    throw new Error('not a KDBX file (bad signature)');
  }
  const versionField = reader.readU32();
  const major = (versionField >>> 16) & 0xffff;
  const minor = versionField & 0xffff;
  if (major !== 3 && major !== 4) {
    throw new Error(`unsupported KDBX major version ${major}`);
  }

  const header: Partial<OuterHeader> & { version: KdbxVersion } = {
    version: { major, minor },
    compression: Compression.None,
  };

  for (;;) {
    const id = reader.readU8();
    const size = kx_isKdbx4(major) ? reader.readI32() : reader.readU16();
    const value = reader.readBytes(size);
    if (id === HeaderFieldId.EndOfHeader) {
      break;
    }
    kx_applyHeaderField(header, id, value);
  }

  return {
    header: kx_finalizeHeader(header),
    rawHeader: data.slice(0, reader.offset),
    offset: reader.offset,
  };
}

function kx_applyHeaderField(
  header: Partial<OuterHeader> & { version: KdbxVersion },
  id: number,
  value: Uint8Array,
): void {
  switch (id) {
    case HeaderFieldId.Comment:
      header.comment = value;
      break;
    case HeaderFieldId.CipherId:
      header.cipherId = value;
      break;
    case HeaderFieldId.CompressionFlags:
      header.compression = new ByteReader(value).readU32();
      break;
    case HeaderFieldId.MasterSeed:
      header.masterSeed = value;
      break;
    case HeaderFieldId.TransformSeed:
      header.transformSeed = value;
      break;
    case HeaderFieldId.TransformRounds:
      header.transformRounds = new ByteReader(value).readU64();
      break;
    case HeaderFieldId.EncryptionIv:
      header.encryptionIv = value;
      break;
    case HeaderFieldId.ProtectedStreamKey:
      header.protectedStreamKey = value;
      break;
    case HeaderFieldId.StreamStartBytes:
      header.streamStartBytes = value;
      break;
    case HeaderFieldId.InnerRandomStreamId:
      header.innerRandomStreamId = new ByteReader(value).readU32();
      break;
    case HeaderFieldId.KdfParameters:
      header.kdfParameters = readVariantDictionary(value);
      break;
    case HeaderFieldId.PublicCustomData:
      header.publicCustomData = readVariantDictionary(value);
      break;
    default:
      // Unknown fields are ignored, per the format's forward-compatibility rule.
      break;
  }
}

function kx_finalizeHeader(header: Partial<OuterHeader> & { version: KdbxVersion }): OuterHeader {
  if (!header.cipherId) {
    throw new Error('outer header is missing the cipher ID');
  }
  if (!header.masterSeed) {
    throw new Error('outer header is missing the master seed');
  }
  if (!header.encryptionIv) {
    throw new Error('outer header is missing the encryption IV');
  }
  return header as OuterHeader;
}

/** Serialize an outer header to its byte encoding. */
export function writeOuterHeader(header: OuterHeader): Uint8Array {
  const major = header.version.major;
  const writer = new ByteWriter();
  writer.writeU32(SIGNATURE_1);
  writer.writeU32(SIGNATURE_2);
  writer.writeU32(((header.version.major & 0xffff) << 16) | (header.version.minor & 0xffff));

  const writeField = (id: number, value: Uint8Array): void => {
    writer.writeU8(id);
    if (kx_isKdbx4(major)) {
      writer.writeI32(value.length);
    } else {
      writer.writeU16(value.length);
    }
    writer.writeBytes(value);
  };

  if (header.comment) {
    writeField(HeaderFieldId.Comment, header.comment);
  }
  writeField(HeaderFieldId.CipherId, header.cipherId);
  writeField(
    HeaderFieldId.CompressionFlags,
    new ByteWriter(4).writeU32(header.compression).toBytes(),
  );
  writeField(HeaderFieldId.MasterSeed, header.masterSeed);

  if (kx_isKdbx4(major)) {
    if (!header.kdfParameters) {
      throw new Error('KDBX 4 header requires KDF parameters');
    }
    writeField(HeaderFieldId.EncryptionIv, header.encryptionIv);
    writeField(HeaderFieldId.KdfParameters, writeVariantDictionary(header.kdfParameters));
    if (header.publicCustomData) {
      writeField(HeaderFieldId.PublicCustomData, writeVariantDictionary(header.publicCustomData));
    }
  } else {
    if (!header.transformSeed || header.transformRounds === undefined) {
      throw new Error('KDBX 3.1 header requires a transform seed and rounds');
    }
    if (!header.protectedStreamKey || !header.streamStartBytes) {
      throw new Error('KDBX 3.1 header requires inner-stream key and stream start bytes');
    }
    writeField(HeaderFieldId.TransformSeed, header.transformSeed);
    writeField(
      HeaderFieldId.TransformRounds,
      new ByteWriter(8).writeU64(header.transformRounds).toBytes(),
    );
    writeField(HeaderFieldId.EncryptionIv, header.encryptionIv);
    writeField(HeaderFieldId.ProtectedStreamKey, header.protectedStreamKey);
    writeField(HeaderFieldId.StreamStartBytes, header.streamStartBytes);
    writeField(
      HeaderFieldId.InnerRandomStreamId,
      new ByteWriter(4).writeU32(header.innerRandomStreamId ?? 0).toBytes(),
    );
  }

  writeField(HeaderFieldId.EndOfHeader, HEADER_END_MARKER);
  return writer.toBytes();
}
