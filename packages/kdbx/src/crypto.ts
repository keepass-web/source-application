/** Crypto primitives via WebCrypto + Web Streams compression, no external deps.
Stream ciphers and Argon2 aren't in WebCrypto — those come from chacha20/argon2. */

import { concatBytes } from './bytes.ts';

function kx_getCrypto(): Crypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('WebCrypto (globalThis.crypto.subtle) is not available in this environment');
  }
  return c;
}

// Our buffers are always ArrayBuffer-backed, so this BufferSource narrowing cast is sound.
function kx_buf(data: Uint8Array): Uint8Array<ArrayBuffer> {
  return data as Uint8Array<ArrayBuffer>;
}

// Fill a fresh array of `length` bytes with cryptographically strong randomness.
export function getRandomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  kx_getCrypto().getRandomValues(out);
  return out;
}

// SHA-256 digest.
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await kx_getCrypto().subtle.digest('SHA-256', kx_buf(data)));
}

// SHA-512 digest.
export async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await kx_getCrypto().subtle.digest('SHA-512', kx_buf(data)));
}

// HMAC-SHA-256 of `data` under `key`.
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

// AES-256-CBC with PKCS#7 padding, as KDBX uses for the outer payload; iv must be 16 bytes.
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

// AES-256-CBC decryption with PKCS#7 padding. The `iv` must be 16 bytes.
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
    /** WebCrypto reports bad PKCS#7 padding as an empty-message DOMException
    (avoids a padding-oracle leak) — the ordinary wrong-password case here. */
    throw new Error('AES-CBC decryption failed (wrong credentials or corrupt file)');
  }
}

/** Ceiling on AES-KDF `rounds`, read from the file before auth — unchecked, a
crafted file could force a many-exabyte allocation just by being opened.
Far above any real KeePass config, but keeps a worst case survivable. */
const KX_MAX_AES_KDF_ROUNDS = 100_000_000n;

/** AES-KDF (KDBX 3.1's KDF): each 16-byte key half is AES-256-ECB'd `rounds`
times under `seed`. WebCrypto has no ECB, so we simulate it via CBC with
the half as IV over `rounds` zero blocks, then SHA-256 the final blocks. */
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
  if (rounds > KX_MAX_AES_KDF_ROUNDS) {
    throw new RangeError(
      `AES-KDF rounds (${rounds}) exceed the maximum this app will run (${KX_MAX_AES_KDF_ROUNDS})`,
    );
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
