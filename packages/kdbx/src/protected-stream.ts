/**
 * The inner random stream that protects sensitive fields (e.g. passwords) in
 * the KDBX XML document.
 *
 * KDBX 3.1 uses Salsa20 with a fixed nonce and a key of SHA-256(streamKey).
 * KDBX 4.x uses ChaCha20 with key/nonce derived from SHA-512(streamKey). In
 * both cases the cipher produces one continuous keystream; protected values are
 * XORed against it in document order, so the order of processing matters.
 */

import { ChaCha20, Salsa20 } from '../../chacha20/dist/src/index.js';
import { InnerStreamCipher, SALSA20_NONCE } from './constants.ts';
import { sha256, sha512 } from './crypto.ts';

/** A stateful XOR transform over the inner random stream's keystream. */
export interface ProtectedStreamCipher {
  process(data: Uint8Array): Uint8Array;
}

/**
 * Create the inner random stream cipher for the given stream ID and key. A
 * fresh cipher must be created for each full read or write pass, since the
 * keystream is consumed in order across all protected values.
 */
export async function createProtectedStreamCipher(
  streamId: number,
  streamKey: Uint8Array,
): Promise<ProtectedStreamCipher> {
  if (streamId === InnerStreamCipher.Salsa20) {
    const key = await sha256(streamKey);
    const cipher = new Salsa20(key, SALSA20_NONCE);
    return { process: (data) => cipher.encrypt(data) };
  }
  if (streamId === InnerStreamCipher.ChaCha20) {
    const hash = await sha512(streamKey);
    const cipher = new ChaCha20(hash.slice(0, 32), hash.slice(32, 44));
    return { process: (data) => cipher.encrypt(data) };
  }
  throw new Error(`unsupported inner random stream cipher ${streamId}`);
}
