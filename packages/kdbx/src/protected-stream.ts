/** Inner random stream protecting sensitive fields: 3.1 uses Salsa20
(key = SHA-256(streamKey)); 4.x uses ChaCha20 (from SHA-512(streamKey)).
One continuous keystream XORed in document order — order matters. */

import { ChaCha20, Salsa20 } from '../../../build/packages/chacha20/src/index.js';
import { InnerStreamCipher, SALSA20_NONCE } from './constants.ts';
import { sha256, sha512 } from './crypto.ts';

// A stateful XOR transform over the inner random stream's keystream.
export interface ProtectedStreamCipher {
  process(data: Uint8Array): Uint8Array;
}

// A fresh cipher is needed per full pass, since the keystream is consumed in order.
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
