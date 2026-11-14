/** Derives the encryption/auth keys from the master seed and the
KDF-transformed composite key (spec: "Computation of Keys"). Each joined
input holds key material, so it's zeroed once hashed (#145). */

import { ByteWriter, concatBytes } from './bytes.ts';
import { sha256, sha512 } from './crypto.ts';

async function kx_hashJoined(
  hash: (data: Uint8Array) => Promise<Uint8Array>,
  ...parts: Uint8Array[]
): Promise<Uint8Array> {
  const joined = concatBytes(...parts);
  try {
    return await hash(joined);
  } finally {
    joined.fill(0);
  }
}

// Final encryption key = SHA-256(masterSeed ‖ transformedKey).
export async function deriveCipherKey(
  masterSeed: Uint8Array,
  transformedKey: Uint8Array,
): Promise<Uint8Array> {
  return kx_hashJoined(sha256, masterSeed, transformedKey);
}

// HMAC base = SHA-512(masterSeed‖transformedKey‖0x01); derives header/per-block HMAC keys.
export async function deriveHmacBaseKey(
  masterSeed: Uint8Array,
  transformedKey: Uint8Array,
): Promise<Uint8Array> {
  return kx_hashJoined(sha512, masterSeed, transformedKey, new Uint8Array([0x01]));
}

// Header HMAC key = SHA-512(0xFFFFFFFFFFFFFFFF ‖ base).
export async function deriveHeaderHmacKey(hmacBaseKey: Uint8Array): Promise<Uint8Array> {
  return kx_hashJoined(sha512, new Uint8Array(8).fill(0xff), hmacBaseKey);
}

// Per-block HMAC key = SHA-512(index_u64le ‖ base).
export async function deriveBlockHmacKey(
  hmacBaseKey: Uint8Array,
  index: bigint,
): Promise<Uint8Array> {
  return kx_hashJoined(sha512, new ByteWriter(8).writeU64(index).toBytes(), hmacBaseKey);
}
