/** Format signatures, identifiers, and magic values defined by the KDBX format. */

import { fromHex } from './bytes.ts';

/** First 32-bit signature (UInt32, little-endian on disk). */
export const SIGNATURE_1 = 0x9aa2d903;
/** Second 32-bit signature, identifying the KDBX 2.x format family (3.1/4.x). */
export const SIGNATURE_2 = 0xb54bfb67;

/** Outer header field IDs. */
export const HeaderFieldId = {
  EndOfHeader: 0,
  Comment: 1,
  CipherId: 2,
  CompressionFlags: 3,
  MasterSeed: 4,
  /** KDBX 3.1 only: AES-KDF transform seed. */
  TransformSeed: 5,
  /** KDBX 3.1 only: AES-KDF rounds. */
  TransformRounds: 6,
  EncryptionIv: 7,
  /** KDBX 3.1 only: inner random stream key. */
  ProtectedStreamKey: 8,
  /** KDBX 3.1 only: expected first bytes of the decrypted payload. */
  StreamStartBytes: 9,
  /** KDBX 3.1 only: inner random stream cipher ID. */
  InnerRandomStreamId: 10,
  /** KDBX 4.x only: KDF parameters (VariantDictionary). */
  KdfParameters: 11,
  /** KDBX 4.x only: public custom data (VariantDictionary). */
  PublicCustomData: 12,
} as const;

/** Inner (encrypted) header field IDs — KDBX 4.x. */
export const InnerHeaderFieldId = {
  EndOfHeader: 0,
  InnerRandomStreamId: 1,
  InnerRandomStreamKey: 2,
  Binary: 3,
} as const;

/** Compression algorithm IDs (header field 3). */
export const Compression = {
  None: 0,
  GZip: 1,
} as const;

/** Inner random stream cipher IDs. */
export const InnerStreamCipher = {
  /** RC4 variant — obsolete, not supported. */
  ArcFourVariant: 1,
  Salsa20: 2,
  ChaCha20: 3,
} as const;

/** Value of the End-of-Header field in the outer header. */
export const HEADER_END_MARKER = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

/** Fixed Salsa20 nonce used by the KDBX 3.1 inner random stream. */
export const SALSA20_NONCE = new Uint8Array([0xe8, 0x30, 0x09, 0x4b, 0x97, 0x20, 0x5d, 0x2a]);

/** Cipher UUIDs (header field 2). */
export const CipherId = {
  Aes256: fromHex('31C1F2E6BF714350BE5805216AFC5AFF'),
  ChaCha20: fromHex('D6038A2B8B6F4CB5A524339A31DBB59A'),
} as const;

/** Key derivation function UUIDs (KDF parameter `$UUID`). */
export const KdfId = {
  Aes: fromHex('C9D9F39A628A4460BF740D08C18A4FEA'),
  Argon2d: fromHex('EF636DDF8C29444B91F7A9A403E30A0C'),
  Argon2id: fromHex('9E298B1956DB4773B23DFC3EC6F0A1E6'),
} as const;

/** VariantDictionary keys used inside KDF parameters. */
export const KdfParam = {
  Uuid: '$UUID',
  /** AES-KDF rounds / Argon2 salt share key letters with distinct meanings per KDF. */
  AesRounds: 'R',
  AesSeed: 'S',
  Argon2Salt: 'S',
  Argon2Parallelism: 'P',
  Argon2Memory: 'M',
  Argon2Iterations: 'I',
  Argon2Version: 'V',
  Argon2Secret: 'K',
  Argon2AssocData: 'A',
} as const;

/** Argon2 version numbers as stored in the KDF parameters. */
export const Argon2Version = {
  V10: 0x10,
  V13: 0x13,
} as const;
