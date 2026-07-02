/**
 * Derivation of the concrete keys used during encryption and authentication,
 * from the master seed (outer header) and the KDF-transformed composite key.
 *
 * See the "Computation of Keys" section of the KDBX specification.
 */

import { ByteWriter, concatBytes } from './bytes.ts';
import { sha256, sha512 } from './crypto.ts';

/** Final encryption key = SHA-256(masterSeed ‖ transformedKey). */
export async function deriveCipherKey(
  masterSeed: Uint8Array,
  transformedKey: Uint8Array,
): Promise<Uint8Array> {
  return sha256(concatBytes(masterSeed, transformedKey));
}

/**
 * Base value for the HMAC keys = SHA-512(masterSeed ‖ transformedKey ‖ 0x01).
 * Used (with a block index) to derive the header and per-block HMAC keys.
 */
export async function deriveHmacBaseKey(
  masterSeed: Uint8Array,
  transformedKey: Uint8Array,
): Promise<Uint8Array> {
  return sha512(concatBytes(masterSeed, transformedKey, new Uint8Array([0x01])));
}

/** Header HMAC key = SHA-512(0xFFFFFFFFFFFFFFFF ‖ base). */
export async function deriveHeaderHmacKey(hmacBaseKey: Uint8Array): Promise<Uint8Array> {
  const index = new Uint8Array(8).fill(0xff);
  return sha512(concatBytes(index, hmacBaseKey));
}

/** Per-block HMAC key = SHA-512(index_u64le ‖ base). */
export async function deriveBlockHmacKey(
  hmacBaseKey: Uint8Array,
  index: bigint,
): Promise<Uint8Array> {
  const indexBytes = new ByteWriter(8).writeU64(index).toBytes();
  return sha512(concatBytes(indexBytes, hmacBaseKey));
}
