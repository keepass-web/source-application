/** Inner random stream protecting sensitive fields: 3.1 uses Salsa20
(key = SHA-256(streamKey)); 4.x uses ChaCha20 (from SHA-512(streamKey)).
One continuous keystream XORed in document order — order matters. */

import { ChaCha20, Salsa20 } from '../../../build/packages/chacha20/src/index.js';
import { InnerStreamCipher, SALSA20_NONCE } from './constants.ts';
import { sha256, sha512 } from './crypto.ts';

// A stateful XOR transform over the inner random stream's keystream; wipe() once the pass is done (#145).
export interface ProtectedStreamCipher {
  process(data: Uint8Array): Uint8Array;
  wipe(): void;
}

// A fresh cipher is needed per full pass, since the keystream is consumed in order.
export async function createProtectedStreamCipher(
  streamId: number,
  streamKey: Uint8Array,
): Promise<ProtectedStreamCipher> {
  if (streamId === InnerStreamCipher.Salsa20) {
    const key = await sha256(streamKey);
    const cipher = new Salsa20(key, SALSA20_NONCE);
    key.fill(0); // the cipher keeps its own copy
    return { process: (data) => cipher.encrypt(data), wipe: () => cipher.wipe() };
  }
  if (streamId === InnerStreamCipher.ChaCha20) {
    const hash = await sha512(streamKey);
    const cipher = new ChaCha20(hash.subarray(0, 32), hash.subarray(32, 44));
    hash.fill(0); // the cipher keeps its own copy
    return { process: (data) => cipher.encrypt(data), wipe: () => cipher.wipe() };
  }
  throw new Error(`unsupported inner random stream cipher ${streamId}`);
}
