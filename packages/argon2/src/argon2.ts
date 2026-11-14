/** Argon2d/Argon2id per RFC 9106 (see SPEC.md). Algorithm core only —
validated public entry points live in index.ts. Each 64-bit word is held as
its little-endian 32-bit halves, keeping the fill loop in plain integer math (#145). */

import { blake2b } from './blake2b.ts';

// Argon2 type code: 0 = Argon2d, 2 = Argon2id (RFC 9106, Section 3.1).
export const ARGON2_D = 0;
export const ARGON2_ID = 2;

// Argon2 version numbers (RFC 9106). 0x13 (19) is current.
export const ARGON2_VERSION_10 = 0x10;
export const ARGON2_VERSION_13 = 0x13;

const A2_SYNC_POINTS = 4; // number of vertical slices (SL)
const A2_HALVES_PER_BLOCK = 256; // 1024 bytes / 4
const A2_ADDRESSES_PER_BLOCK = 128;
// Where the zero, input and address blocks sit in a segment's addressing scratch.
const A2_ZERO = 0;
const A2_INPUT = A2_HALVES_PER_BLOCK;
const A2_ADDRESS = 2 * A2_HALVES_PER_BLOCK;

export interface CoreParams {
  password: Uint8Array;
  salt: Uint8Array;
  secret: Uint8Array;
  associatedData: Uint8Array;
  parallelism: number;
  // Memory size in KiB.
  memory: number;
  iterations: number;
  tagLength: number;
  version: number;
  // 0 for Argon2d, 2 for Argon2id.
  type: number;
}

function a2_le32(n: number): Uint8Array {
  const out = new Uint8Array(4);
  out[0] = n & 0xff;
  out[1] = (n >>> 8) & 0xff;
  out[2] = (n >>> 16) & 0xff;
  out[3] = (n >>> 24) & 0xff;
  return out;
}

function a2_concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) {
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function a2_bytesToBlock(bytes: Uint8Array, out: Uint32Array, at: number): void {
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const i = 4 * k;
    out[at + k] =
      ((bytes[i] as number) |
        ((bytes[i + 1] as number) << 8) |
        ((bytes[i + 2] as number) << 16) |
        ((bytes[i + 3] as number) << 24)) >>>
      0;
  }
}

function a2_blockToBytes(block: Uint32Array, out: Uint8Array): void {
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const half = block[k] as number;
    out[4 * k] = half;
    out[4 * k + 1] = half >>> 8;
    out[4 * k + 2] = half >>> 16;
    out[4 * k + 3] = half >>> 24;
  }
}

/** Variable-length hash H' (RFC 9106 §3.3) of input into out, built on BLAKE2b. The caller
owns out; every intermediate digest here is zeroed on every path (#145). */
function a2_hPrime(out: Uint8Array, input: Uint8Array): void {
  const prefixed = a2_concatBytes(a2_le32(out.length), input);
  let v: Uint8Array = new Uint8Array(0);
  try {
    if (out.length <= 64) {
      v = blake2b(out.length, prefixed);
      out.set(v);
      return;
    }
    const blocks = Math.ceil(out.length / 32) - 2;
    v = blake2b(64, prefixed);
    out.set(v.subarray(0, 32), 0);
    let pos = 32;
    for (let i = 2; i <= blocks; i++) {
      const next = blake2b(64, v);
      v.fill(0);
      v = next;
      out.set(v.subarray(0, 32), pos);
      pos += 32;
    }
    const last = blake2b(out.length - 32 * blocks, v);
    out.set(last, pos);
    last.fill(0);
  } finally {
    prefixed.fill(0);
    v.fill(0);
  }
}

// High 32 bits of x * y: the double product is within 2^11 of exact, so rounding recovers them.
function a2_mulHi(x: number, y: number): number {
  return Math.round((x * y - (Math.imul(x, y) >>> 0)) / 0x100000000);
}

// Scratch for every G call; Argon2 runs synchronously, so no two calls share them at once.
const A2_R = new Uint32Array(A2_HALVES_PER_BLOCK);
const A2_TMP = new Uint32Array(A2_HALVES_PER_BLOCK);

/** GB, the modified BLAKE2b mixing function with multiplications (RFC 9106 §3.6), on the words of
A2_R at a, b, c, d. Each word's halves stay in locals, read and written once; each x + y +
2 * lo32(x) * lo32(y) step takes the product's high half as a2_mulHi does, reusing its low half p. */
function a2_gb(a: number, b: number, c: number, d: number): void {
  const v = A2_R;
  let al = v[a] as number;
  let ah = v[a + 1] as number;
  let bl = v[b] as number;
  let bh = v[b + 1] as number;
  let cl = v[c] as number;
  let ch = v[c + 1] as number;
  let dl = v[d] as number;
  let dh = v[d + 1] as number;
  let p: number;
  let s: number;
  let xl: number;
  let xh: number;

  p = Math.imul(al, bl) >>> 0; // a = a + b + 2 * lo32(a) * lo32(b)
  s = al + bl + ((p << 1) >>> 0);
  ah =
    (ah +
      bh +
      (((Math.round((al * bl - p) / 0x100000000) << 1) | (p >>> 31)) >>> 0) +
      ((s / 0x100000000) | 0)) >>>
    0;
  al = s >>> 0;
  xl = (dl ^ al) >>> 0; // d = rotr64(d ^ a, 32)
  dl = (dh ^ ah) >>> 0;
  dh = xl;

  p = Math.imul(cl, dl) >>> 0; // c = c + d + 2 * lo32(c) * lo32(d)
  s = cl + dl + ((p << 1) >>> 0);
  ch =
    (ch +
      dh +
      (((Math.round((cl * dl - p) / 0x100000000) << 1) | (p >>> 31)) >>> 0) +
      ((s / 0x100000000) | 0)) >>>
    0;
  cl = s >>> 0;
  xl = (bl ^ cl) >>> 0; // b = rotr64(b ^ c, 24)
  xh = (bh ^ ch) >>> 0;
  bl = ((xl >>> 24) | (xh << 8)) >>> 0;
  bh = ((xh >>> 24) | (xl << 8)) >>> 0;

  p = Math.imul(al, bl) >>> 0; // a = a + b + 2 * lo32(a) * lo32(b)
  s = al + bl + ((p << 1) >>> 0);
  ah =
    (ah +
      bh +
      (((Math.round((al * bl - p) / 0x100000000) << 1) | (p >>> 31)) >>> 0) +
      ((s / 0x100000000) | 0)) >>>
    0;
  al = s >>> 0;
  xl = (dl ^ al) >>> 0; // d = rotr64(d ^ a, 16)
  xh = (dh ^ ah) >>> 0;
  dl = ((xl >>> 16) | (xh << 16)) >>> 0;
  dh = ((xh >>> 16) | (xl << 16)) >>> 0;

  p = Math.imul(cl, dl) >>> 0; // c = c + d + 2 * lo32(c) * lo32(d)
  s = cl + dl + ((p << 1) >>> 0);
  ch =
    (ch +
      dh +
      (((Math.round((cl * dl - p) / 0x100000000) << 1) | (p >>> 31)) >>> 0) +
      ((s / 0x100000000) | 0)) >>>
    0;
  cl = s >>> 0;
  xl = (bl ^ cl) >>> 0; // b = rotr64(b ^ c, 63)
  xh = (bh ^ ch) >>> 0;
  bl = ((xh >>> 31) | (xl << 1)) >>> 0;
  bh = ((xl >>> 31) | (xh << 1)) >>> 0;

  v[a] = al;
  v[a + 1] = ah;
  v[b] = bl;
  v[b + 1] = bh;
  v[c] = cl;
  v[c + 1] = ch;
  v[d] = dl;
  v[d + 1] = dh;
}

// Permutation P on the 16 words of A2_R whose low halves sit at w0..w15 (RFC 9106, Section 3.6).
function a2_permute(
  w0: number,
  w1: number,
  w2: number,
  w3: number,
  w4: number,
  w5: number,
  w6: number,
  w7: number,
  w8: number,
  w9: number,
  w10: number,
  w11: number,
  w12: number,
  w13: number,
  w14: number,
  w15: number,
): void {
  a2_gb(w0, w4, w8, w12);
  a2_gb(w1, w5, w9, w13);
  a2_gb(w2, w6, w10, w14);
  a2_gb(w3, w7, w11, w15);
  a2_gb(w0, w5, w10, w15);
  a2_gb(w1, w6, w11, w12);
  a2_gb(w2, w7, w8, w13);
  a2_gb(w3, w4, w9, w14);
}

/** G (RFC 9106 §3.5) on the blocks of m starting at prev, ref and next: next = (with_xor?next:0)
XOR R XOR P_columns(P_rows(R)), where R=ref XOR prev. The block is an 8x8 matrix of 16-byte
registers; a row is 16 consecutive words, a column 8 word pairs one row apart. */
function a2_fillBlock(
  m: Uint32Array,
  prev: number,
  ref: number,
  next: number,
  withXor: boolean,
): void {
  const keep = withXor ? 0xffffffff : 0; // how much of next's old content XORs in
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const r = ((m[ref + k] as number) ^ (m[prev + k] as number)) >>> 0;
    A2_R[k] = r;
    A2_TMP[k] = (r ^ ((m[next + k] as number) & keep)) >>> 0;
  }
  for (let b = 0; b < A2_HALVES_PER_BLOCK; b += 32) {
    a2_permute(
      b,
      b + 2,
      b + 4,
      b + 6,
      b + 8,
      b + 10,
      b + 12,
      b + 14,
      b + 16,
      b + 18,
      b + 20,
      b + 22,
      b + 24,
      b + 26,
      b + 28,
      b + 30,
    );
  }
  for (let c = 0; c < 32; c += 4) {
    a2_permute(
      c,
      c + 2,
      c + 32,
      c + 34,
      c + 64,
      c + 66,
      c + 96,
      c + 98,
      c + 128,
      c + 130,
      c + 160,
      c + 162,
      c + 192,
      c + 194,
      c + 224,
      c + 226,
    );
  }
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    m[next + k] = ((A2_TMP[k] as number) ^ (A2_R[k] as number)) >>> 0;
  }
}

// Map a pseudo-random value to a reference block index in a lane (RFC 9106 §3.4.2, index_alpha).
function a2_indexAlpha(
  pass: number,
  slice: number,
  index: number,
  segmentLength: number,
  laneLength: number,
  pseudoRand: number,
  sameLane: boolean,
): number {
  let referenceAreaSize: number;
  if (pass === 0) {
    if (slice === 0) {
      referenceAreaSize = index - 1;
    } else if (sameLane) {
      referenceAreaSize = slice * segmentLength + index - 1;
    } else {
      referenceAreaSize = slice * segmentLength + (index === 0 ? -1 : 0);
    }
  } else if (sameLane) {
    referenceAreaSize = laneLength - segmentLength + index - 1;
  } else {
    referenceAreaSize = laneLength - segmentLength + (index === 0 ? -1 : 0);
  }

  const x = a2_mulHi(pseudoRand, pseudoRand);
  const relative = referenceAreaSize - 1 - a2_mulHi(referenceAreaSize, x);

  let startPosition = 0;
  if (pass !== 0) {
    startPosition = slice === A2_SYNC_POINTS - 1 ? 0 : (slice + 1) * segmentLength;
  }
  return (startPosition + relative) % laneLength;
}

/** Run the full Argon2 operation and return the tag. Everything derived from the password is
zeroed before returning or throwing, and the tag too when it isn't returned (#145). */
export function argon2Core(params: CoreParams): Uint8Array {
  const tag = new Uint8Array(params.tagLength);
  let h0Input: Uint8Array = new Uint8Array(0);
  let h0: Uint8Array = new Uint8Array(0);
  const laneSeed = new Uint8Array(72); // H_0 ‖ column ‖ lane
  const blockBytes = new Uint8Array(1024);
  let store = new Uint32Array(0);
  const c = new Uint32Array(A2_HALVES_PER_BLOCK);
  try {
    h0Input = a2_h0Input(params);
    h0 = blake2b(64, h0Input);
    // Step 2: the memory matrix B[lanes][columns], allocated here so the finally below wipes it.
    const lanes = params.parallelism;
    store = new Uint32Array(
      4 * lanes * Math.floor(params.memory / (4 * lanes)) * A2_HALVES_PER_BLOCK,
    );
    a2_fill(params, store, h0, laneSeed, blockBytes);
    a2_finalBlock(params, store, c);
    a2_blockToBytes(c, blockBytes);
    a2_hPrime(tag, blockBytes); // Step 8: tag = H'^T(C).
  } catch (err) {
    tag.fill(0);
    throw err;
  } finally {
    h0Input.fill(0);
    h0.fill(0);
    laneSeed.fill(0);
    blockBytes.fill(0);
    store.fill(0);
    c.fill(0);
    A2_R.fill(0);
    A2_TMP.fill(0);
  }
  return tag;
}

// Step 1: the input hashed into H_0.
function a2_h0Input(params: CoreParams): Uint8Array {
  const { password, salt, secret, associatedData } = params;
  return a2_concatBytes(
    a2_le32(params.parallelism),
    a2_le32(params.tagLength),
    a2_le32(params.memory),
    a2_le32(params.iterations),
    a2_le32(params.version),
    a2_le32(params.type),
    a2_le32(password.length),
    password,
    a2_le32(salt.length),
    salt,
    a2_le32(secret.length),
    secret,
    a2_le32(associatedData.length),
    associatedData,
  );
}

// Steps 3-6: fill the memory matrix in store; laneSeed and blockBytes are scratch.
function a2_fill(
  params: CoreParams,
  store: Uint32Array,
  h0: Uint8Array,
  laneSeed: Uint8Array,
  blockBytes: Uint8Array,
): void {
  const lanes = params.parallelism;
  const passes = params.iterations;
  const version = params.version;
  const type = params.type;
  const memoryBlocks = store.length / A2_HALVES_PER_BLOCK;
  const columns = memoryBlocks / lanes;
  const segmentLength = columns / A2_SYNC_POINTS;
  const at = (lane: number, col: number): number => (lane * columns + col) * A2_HALVES_PER_BLOCK;

  // Steps 3-4: first two columns of each lane.
  laneSeed.set(h0);
  for (let lane = 0; lane < lanes; lane++) {
    laneSeed.set(a2_le32(lane), 68);
    for (let col = 0; col < 2; col++) {
      laneSeed.set(a2_le32(col), 64);
      a2_hPrime(blockBytes, laneSeed);
      a2_bytesToBlock(blockBytes, store, at(lane, col));
    }
  }

  const fillSegment = (pass: number, slice: number, lane: number): void => {
    const dataIndependent = type === ARGON2_ID && pass === 0 && slice < A2_SYNC_POINTS / 2;

    // The zero, input and address blocks of data-independent addressing (RFC 9106 §3.4.1.2).
    const addressing = new Uint32Array(dataIndependent ? 3 * A2_HALVES_PER_BLOCK : 0);
    const nextAddresses = (): void => {
      addressing[A2_INPUT + 12] = (addressing[A2_INPUT + 12] as number) + 1; // word 6, the counter
      a2_fillBlock(addressing, A2_ZERO, A2_INPUT, A2_ADDRESS, false);
      a2_fillBlock(addressing, A2_ZERO, A2_ADDRESS, A2_ADDRESS, false);
    };

    if (dataIndependent) {
      addressing[A2_INPUT] = pass;
      addressing[A2_INPUT + 2] = lane;
      addressing[A2_INPUT + 4] = slice;
      addressing[A2_INPUT + 6] = memoryBlocks;
      addressing[A2_INPUT + 8] = passes;
      addressing[A2_INPUT + 10] = type;
    }

    let startIndex = 0;
    if (pass === 0 && slice === 0) {
      startIndex = 2;
      if (dataIndependent) {
        nextAddresses();
      }
    }

    for (let index = startIndex; index < segmentLength; index++) {
      const col = slice * segmentLength + index;
      const prevCol = col === 0 ? columns - 1 : col - 1;

      // J1 and J2 (RFC 9106 §3.4.1) are the low and high halves of a 64-bit word.
      let source: Uint32Array;
      let word: number;
      if (dataIndependent) {
        if (index % A2_ADDRESSES_PER_BLOCK === 0) {
          nextAddresses();
        }
        source = addressing;
        word = A2_ADDRESS + 2 * (index % A2_ADDRESSES_PER_BLOCK);
      } else {
        source = store;
        word = at(lane, prevCol);
      }
      const j1 = source[word] as number;
      const j2 = source[word + 1] as number;

      let refLane = j2 % lanes;
      if (pass === 0 && slice === 0) {
        refLane = lane;
      }

      const refIndex = a2_indexAlpha(
        pass,
        slice,
        index,
        segmentLength,
        columns,
        j1,
        refLane === lane,
      );

      const withXor = version !== ARGON2_VERSION_10 && pass > 0;
      a2_fillBlock(store, at(lane, prevCol), at(refLane, refIndex), at(lane, col), withXor);
    }
  };

  // Steps 5-6: fill the matrix, slicewise across all lanes.
  for (let pass = 0; pass < passes; pass++) {
    for (let slice = 0; slice < A2_SYNC_POINTS; slice++) {
      for (let lane = 0; lane < lanes; lane++) {
        fillSegment(pass, slice, lane);
      }
    }
  }
}

// Step 7: final block C, the XOR of the last column across lanes, into c.
function a2_finalBlock(params: CoreParams, store: Uint32Array, c: Uint32Array): void {
  const lanes = params.parallelism;
  const laneHalves = store.length / lanes;
  for (let lane = 0; lane < lanes; lane++) {
    const last = (lane + 1) * laneHalves - A2_HALVES_PER_BLOCK;
    for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
      c[k] = ((c[k] as number) ^ (store[last + k] as number)) >>> 0;
    }
  }
}
