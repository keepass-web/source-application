/**
 * Cryptographic primitives backed by WebCrypto and the Web Streams compression
 * API, so the same code runs in browsers and in modern Node without any
 * external dependency.
 *
 * The stream ciphers (ChaCha20/Salsa20) and the memory-hard KDFs
 * (Argon2d/Argon2id) are not available in WebCrypto; those come from the
 * sibling `chacha20` and `argon2` packages and are wired in by the modules
 * that need them.
 */

import { concatBytes } from './bytes.ts';

function kx_getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto (globalThis.crypto.subtle) is not available in this environment');
  }
  return c;
}

/**
 * WebCrypto's `BufferSource` is parameterized over `ArrayBuffer` (not
 * `SharedArrayBuffer`). Our buffers are always `ArrayBuffer`-backed, so this
 * narrowing cast is sound and avoids copying large payloads.
 */
function kx_buf(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

/** Fill a fresh array of `length` bytes with cryptographically strong randomness. */
export function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  kx_getCrypto().getRandomValues(out);
  return out;
}

/** SHA-256 digest. */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await kx_getCrypto().subtle.digest('SHA-256', kx_buf(data)));
}

/** SHA-512 digest. */
export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await kx_getCrypto().subtle.digest('SHA-512', kx_buf(data)));
}

/** HMAC-SHA-256 of `data` under `key`. */
export async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = kx_getCrypto().subtle;
  const cryptoKey = await subtle.importKey(
    'raw',
    kx_buf(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await subtle.sign('HMAC', cryptoKey, kx_buf(data)));
}

/**
 * AES-256-CBC encryption with PKCS#7 padding (as used by KDBX for the outer
 * payload). The `iv` must be 16 bytes.
 */
export async function aesCbcEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = kx_getCrypto().subtle;
  const cryptoKey = await subtle.importKey('raw', kx_buf(key), 'AES-CBC', false, ['encrypt']);
  return new Uint8Array(
    await subtle.encrypt({ name: 'AES-CBC', iv: kx_buf(iv) }, cryptoKey, kx_buf(data)),
  );
}

/** AES-256-CBC decryption with PKCS#7 padding. The `iv` must be 16 bytes. */
export async function aesCbcDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = kx_getCrypto().subtle;
  const cryptoKey = await subtle.importKey('raw', kx_buf(key), 'AES-CBC', false, ['decrypt']);
  try {
    return new Uint8Array(
      await subtle.decrypt({ name: 'AES-CBC', iv: kx_buf(iv) }, cryptoKey, kx_buf(data)),
    );
  } catch {
    // WebCrypto throws a DOMException with an empty message on a PKCS#7
    // padding failure (deliberately, to avoid a padding-oracle side
    // channel) — and a wrong key almost always produces invalid padding, so
    // this is the ordinary "wrong password" case for KDBX 3.1 files, not a
    // rare corruption edge case. Give callers something to show the user.
    throw new Error('AES-CBC decryption failed (wrong credentials or corrupt file)');
  }
}

/**
 * AES-KDF transformation (the KDBX 3.1 / legacy key derivation function).
 *
 * The composite key is split into two 16-byte halves; each half is encrypted
 * `rounds` times with AES-256-ECB under `seed`. WebCrypto has no ECB mode, but
 * encrypting `rounds` zero blocks in CBC mode with the half as the IV yields
 * the same chain: the i-th CBC ciphertext block equals AES^i(half). We take the
 * last real block, then SHA-256 the concatenation.
 */
export async function aesKdfTransform(
  key: Uint8Array,
  seed: Uint8Array,
  rounds: bigint,
): Promise<Uint8Array> {
  if (key.length !== 32) {
    throw new RangeError(`AES-KDF expects a 32-byte key, got ${key.length}`);
  }
  if (rounds <= 0n) {
    throw new RangeError('AES-KDF rounds must be positive');
  }
  if (rounds > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('AES-KDF rounds exceed the supported maximum');
  }
  const n = Number(rounds);
  const subtle = kx_getCrypto().subtle;
  const cryptoKey = await subtle.importKey('raw', kx_buf(seed), 'AES-CBC', false, ['encrypt']);

  const transformHalf = async (iv: Uint8Array): Promise<Uint8Array> => {
    // `n` zero plaintext blocks; CBC produces an extra PKCS#7 padding block,
    // so the value we want (AES^n) is the n-th block, i.e. bytes [16*(n-1), 16*n).
    const zeros = new Uint8Array(16 * n);
    const ciphertext = new Uint8Array(
      await subtle.encrypt({ name: 'AES-CBC', iv: kx_buf(iv) }, cryptoKey, kx_buf(zeros)),
    );
    return ciphertext.slice(16 * (n - 1), 16 * n);
  };

  const left = await transformHalf(key.slice(0, 16));
  const right = await transformHalf(key.slice(16, 32));
  return sha256(concatBytes(left, right));
}

async function kx_runTransformStream(
  stream: { readable: ReadableStream<Uint8Array>; writable: WritableStream<BufferSource> },
  data: Uint8Array,
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(kx_buf(data));
  void writer.close();
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }
  return concatBytes(...chunks);
}

/** GZip-compress `data` (RFC 1952), matching KDBX compression algorithm 1. */
export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  return kx_runTransformStream(new CompressionStream('gzip'), data);
}

/** GZip-decompress `data`. */
export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return kx_runTransformStream(new DecompressionStream('gzip'), data);
}
