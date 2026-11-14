/** BLAKE2b (RFC 7693), Argon2's H (RFC 9106 §3.2) — unkeyed, 1..64-byte output. Each 64-bit word
is held as its little-endian 32-bit halves in typed arrays, which zeroing really clears; a bigint
would leave a copy behind for every operation (#145). */

// BLAKE2b initialization vector (RFC 7693, Section 2.6), as low/high halves.
const B2_IV: readonly number[] = [
  0xf3bcc908, 0x6a09e667, 0x84caa73b, 0xbb67ae85, 0xfe94f82b, 0x3c6ef372, 0x5f1d36f1, 0xa54ff53a,
  0xade682d1, 0x510e527f, 0x2b3e6c1f, 0x9b05688c, 0xfb41bd6b, 0x1f83d9ab, 0x137e2179, 0x5be0cd19,
];

// Message word schedule per round (RFC 7693, Section 2.7).
const B2_SIGMA: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const B2_NOTHING = new Uint32Array(2); // a zero word, for the additions that take no message word

// Word a of v += word b of v + word x of m, mod 2^64 (each named by its low half's offset).
function b2_add(v: Uint32Array, a: number, b: number, m: Uint32Array, x: number): void {
  const lo = (v[a] as number) + (v[b] as number) + (m[x] as number);
  v[a + 1] =
    ((v[a + 1] as number) +
      (v[b + 1] as number) +
      (m[x + 1] as number) +
      ((lo / 0x100000000) | 0)) >>>
    0;
  v[a] = lo >>> 0;
}

// Word x of v = rotr64(word x ^ word y, n).
function b2_xorRotr(v: Uint32Array, x: number, y: number, n: number): void {
  const lo = ((v[x] as number) ^ (v[y] as number)) >>> 0;
  const hi = ((v[x + 1] as number) ^ (v[y + 1] as number)) >>> 0;
  if (n === 32) {
    v[x] = hi;
    v[x + 1] = lo;
  } else if (n < 32) {
    v[x] = ((lo >>> n) | (hi << (32 - n))) >>> 0;
    v[x + 1] = ((hi >>> n) | (lo << (32 - n))) >>> 0;
  } else {
    v[x] = ((hi >>> (n - 32)) | (lo << (64 - n))) >>> 0;
    v[x + 1] = ((lo >>> (n - 32)) | (hi << (64 - n))) >>> 0;
  }
}

// The BLAKE2b mixing function G (RFC 7693, Section 3.1) on words a..d of v and words x, y of m.
function b2_mix(
  v: Uint32Array,
  m: Uint32Array,
  a: number,
  b: number,
  c: number,
  d: number,
  x: number,
  y: number,
): void {
  const wa = 2 * a;
  const wb = 2 * b;
  const wc = 2 * c;
  const wd = 2 * d;
  b2_add(v, wa, wb, m, 2 * x);
  b2_xorRotr(v, wd, wa, 32);
  b2_add(v, wc, wd, B2_NOTHING, 0);
  b2_xorRotr(v, wb, wc, 24);
  b2_add(v, wa, wb, m, 2 * y);
  b2_xorRotr(v, wd, wa, 16);
  b2_add(v, wc, wd, B2_NOTHING, 0);
  b2_xorRotr(v, wb, wc, 63);
}

// The BLAKE2b compression function F (RFC 7693, Section 3.2); v is scratch for the working vector.
function b2_compress(
  h: Uint32Array,
  m: Uint32Array,
  v: Uint32Array,
  counter: number,
  last: boolean,
): void {
  v.set(h, 0);
  v.set(B2_IV, 16);
  v[24] = ((v[24] as number) ^ (counter % 0x100000000)) >>> 0; // t0 into word 12; t1 stays 0
  v[25] = ((v[25] as number) ^ Math.floor(counter / 0x100000000)) >>> 0;
  if (last) {
    v[28] = ~(v[28] as number) >>> 0; // word 14
    v[29] = ~(v[29] as number) >>> 0;
  }
  for (let r = 0; r < 12; r++) {
    const s = B2_SIGMA[r] as readonly number[];
    const w = (k: number): number => s[k] as number;
    b2_mix(v, m, 0, 4, 8, 12, w(0), w(1));
    b2_mix(v, m, 1, 5, 9, 13, w(2), w(3));
    b2_mix(v, m, 2, 6, 10, 14, w(4), w(5));
    b2_mix(v, m, 3, 7, 11, 15, w(6), w(7));
    b2_mix(v, m, 0, 5, 10, 15, w(8), w(9));
    b2_mix(v, m, 1, 6, 11, 12, w(10), w(11));
    b2_mix(v, m, 2, 7, 8, 13, w(12), w(13));
    b2_mix(v, m, 3, 4, 9, 14, w(14), w(15));
  }
  for (let i = 0; i < 16; i++) {
    h[i] = ((h[i] as number) ^ (v[i] as number) ^ (v[i + 16] as number)) >>> 0;
  }
}

/** Unkeyed BLAKE2b digest of `input`.
@param outLength digest length in bytes, 1..64.
@param input message to hash. */
export function blake2b(outLength: number, input: Uint8Array): Uint8Array {
  if (!Number.isInteger(outLength) || outLength < 1 || outLength > 64) {
    throw new RangeError(`BLAKE2b output length must be an integer in 1..64, got ${outLength}`);
  }

  const h = Uint32Array.from(B2_IV);
  const block = new Uint32Array(32);
  const v = new Uint32Array(32);
  try {
    // Parameter block: digest length, key length (0), fanout (1), depth (1).
    h[0] = ((h[0] as number) ^ 0x01010000 ^ outLength) >>> 0;

    // Process all full 128-byte blocks except the final one.
    let counter = 0;
    let offset = 0;

    const loadBlock = (start: number): void => {
      for (let i = 0; i < 32; i++) {
        let half = 0;
        // Manual little-endian load so we can tolerate a short final block.
        for (let b = 0; b < 4; b++) {
          const idx = start + 4 * i + b;
          half |= (idx < input.length ? (input[idx] as number) : 0) << (8 * b);
        }
        block[i] = half >>> 0;
      }
    };

    while (input.length - offset > 128) {
      loadBlock(offset);
      counter += 128;
      b2_compress(h, block, v, counter, false);
      offset += 128;
    }

    // Final block (also covers the empty-input case, where one zero block runs).
    counter += input.length - offset;
    loadBlock(offset);
    b2_compress(h, block, v, counter, true);

    // Serialize the first `outLength` bytes of the state, little-endian.
    const out = new Uint8Array(outLength);
    for (let i = 0; i < outLength; i++) {
      out[i] = ((h[i >> 2] as number) >>> (8 * (i & 3))) & 0xff;
    }
    return out;
  } finally {
    h.fill(0);
    block.fill(0);
    v.fill(0);
  }
}
