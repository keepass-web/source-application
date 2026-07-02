/**
 * BLAKE2b ([RFC 7693](https://www.rfc-editor.org/rfc/rfc7693)), the underlying
 * hash function `H` used by Argon2 (RFC 9106, Section 3.2).
 *
 * This is an unkeyed implementation with a variable output length of 1..64
 * bytes, which is all Argon2 requires. The 64-bit arithmetic is implemented
 * with `bigint` for correctness; see SPEC.md for the optimization trade-off.
 */

const B2_MASK64 = (1n << 64n) - 1n;

/** BLAKE2b initialization vector (RFC 7693, Section 2.6). */
const B2_IV: readonly bigint[] = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n,
];

/** Message word schedule per round (RFC 7693, Section 2.7). */
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

function b2_rotr64(x: bigint, n: bigint): bigint {
  return ((x >> n) | (x << (64n - n))) & B2_MASK64;
}

/** The BLAKE2b mixing function G (RFC 7693, Section 3.1). */
function b2_mix(v: bigint[], a: number, b: number, c: number, d: number, x: bigint, y: bigint): void {
  let va = v[a] as bigint;
  let vb = v[b] as bigint;
  let vc = v[c] as bigint;
  let vd = v[d] as bigint;
  va = (va + vb + x) & B2_MASK64;
  vd = b2_rotr64(vd ^ va, 32n);
  vc = (vc + vd) & B2_MASK64;
  vb = b2_rotr64(vb ^ vc, 24n);
  va = (va + vb + y) & B2_MASK64;
  vd = b2_rotr64(vd ^ va, 16n);
  vc = (vc + vd) & B2_MASK64;
  vb = b2_rotr64(vb ^ vc, 63n);
  v[a] = va;
  v[b] = vb;
  v[c] = vc;
  v[d] = vd;
}

/** The BLAKE2b compression function F (RFC 7693, Section 3.2). */
function b2_compress(h: bigint[], m: bigint[], counter: bigint, last: boolean): void {
  const v = new Array<bigint>(16);
  for (let i = 0; i < 8; i++) {
    v[i] = h[i] as bigint;
    v[i + 8] = B2_IV[i] as bigint;
  }
  v[12] = (v[12] as bigint) ^ (counter & B2_MASK64);
  v[13] = (v[13] as bigint) ^ ((counter >> 64n) & B2_MASK64);
  if (last) {
    v[14] = (v[14] as bigint) ^ B2_MASK64;
  }
  for (let r = 0; r < 12; r++) {
    const s = B2_SIGMA[r] as readonly number[];
    const w = (k: number): bigint => m[s[k] as number] as bigint;
    b2_mix(v, 0, 4, 8, 12, w(0), w(1));
    b2_mix(v, 1, 5, 9, 13, w(2), w(3));
    b2_mix(v, 2, 6, 10, 14, w(4), w(5));
    b2_mix(v, 3, 7, 11, 15, w(6), w(7));
    b2_mix(v, 0, 5, 10, 15, w(8), w(9));
    b2_mix(v, 1, 6, 11, 12, w(10), w(11));
    b2_mix(v, 2, 7, 8, 13, w(12), w(13));
    b2_mix(v, 3, 4, 9, 14, w(14), w(15));
  }
  for (let i = 0; i < 8; i++) {
    h[i] = (h[i] as bigint) ^ (v[i] as bigint) ^ (v[i + 8] as bigint);
  }
}

/**
 * Compute the unkeyed BLAKE2b digest of `input`.
 *
 * @param outLength desired digest length in bytes, 1..64.
 * @param input message to hash.
 */
export function blake2b(outLength: number, input: Uint8Array): Uint8Array {
  if (!Number.isInteger(outLength) || outLength < 1 || outLength > 64) {
    throw new RangeError(`BLAKE2b output length must be an integer in 1..64, got ${outLength}`);
  }

  // Parameter block: digest length, key length (0), fanout (1), depth (1).
  const h = B2_IV.slice();
  h[0] = (h[0] as bigint) ^ 0x01010000n ^ BigInt(outLength);

  // Process all full 128-byte blocks except the final one.
  const block = new Array<bigint>(16);
  let counter = 0n;
  let offset = 0;

  const loadBlock = (start: number): void => {
    for (let i = 0; i < 16; i++) {
      const at = start + i * 8;
      let word = 0n;
      // Manual little-endian load so we can tolerate a short final block.
      for (let b = 0; b < 8; b++) {
        const idx = at + b;
        const byte = idx < input.length ? (input[idx] as number) : 0;
        word |= BigInt(byte) << BigInt(8 * b);
      }
      block[i] = word;
    }
  };

  while (input.length - offset > 128) {
    loadBlock(offset);
    counter += 128n;
    b2_compress(h, block, counter, false);
    offset += 128;
  }

  // Final block (also covers the empty-input case, where one zero block runs).
  const remaining = input.length - offset;
  counter += BigInt(remaining);
  loadBlock(offset);
  b2_compress(h, block, counter, true);

  // Serialize the first `outLength` bytes of the state, little-endian.
  const out = new Uint8Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const word = h[Math.floor(i / 8)] as bigint;
    out[i] = Number((word >> BigInt(8 * (i % 8))) & 0xffn);
  }
  return out;
}
