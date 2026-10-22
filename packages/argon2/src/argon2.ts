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

function a2_bytesToBlock(bytes: Uint8Array, out: Uint32Array): void {
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const i = 4 * k;
    out[k] =
      (bytes[i] as number) |
      ((bytes[i + 1] as number) << 8) |
      ((bytes[i + 2] as number) << 16) |
      ((bytes[i + 3] as number) << 24);
  }
}

function a2_blockToBytes(block: Uint32Array): Uint8Array {
  const out = new Uint8Array(1024);
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const half = block[k] as number;
    out[4 * k] = half;
    out[4 * k + 1] = half >>> 8;
    out[4 * k + 2] = half >>> 16;
    out[4 * k + 3] = half >>> 24;
  }
  return out;
}

// Variable-length hash H' (RFC 9106 §3.3), built on BLAKE2b.
function a2_hPrime(outLength: number, input: Uint8Array): Uint8Array {
  if (outLength <= 64) {
    return blake2b(outLength, a2_concatBytes(a2_le32(outLength), input));
  }
  const out = new Uint8Array(outLength);
  const blocks = Math.ceil(outLength / 32) - 2;
  let v = blake2b(64, a2_concatBytes(a2_le32(outLength), input));
  out.set(v.subarray(0, 32), 0);
  let pos = 32;
  for (let i = 2; i <= blocks; i++) {
    v = blake2b(64, v);
    out.set(v.subarray(0, 32), pos);
    pos += 32;
  }
  out.set(blake2b(outLength - 32 * blocks, v), pos);
  return out;
}

/** P's index patterns over the 1024-byte block as an 8x8 register matrix
(RFC 9106 §3.5), as offsets of each word's low half. */
const A2_ROWS: number[][] = [];
const A2_COLS: number[][] = [];
for (let r = 0; r < 8; r++) {
  const row: number[] = [];
  const col: number[] = [];
  for (let k = 0; k < 16; k++) {
    row.push(2 * (16 * r + k));
  }
  for (let k = 0; k < 8; k++) {
    col.push(2 * (2 * r + 16 * k));
    col.push(2 * (2 * r + 16 * k + 1));
  }
  A2_ROWS.push(row);
  A2_COLS.push(col);
}

// High 32 bits of x * y; 16-bit limbs keep every partial product exact in a double.
function a2_mulHi(x: number, y: number): number {
  const xLo = x & 0xffff;
  const xHi = x >>> 16;
  const yLo = y & 0xffff;
  const yHi = y >>> 16;
  const cross = xHi * yLo + xLo * yHi + ((xLo * yLo) >>> 16);
  return xHi * yHi + Math.floor(cross / 0x10000);
}

// Word x += word y + 2 * lo32(x) * lo32(y), mod 2^64 (BlaMka, RFC 9106 §3.6).
function a2_blamka(v: Uint32Array, x: number, y: number): void {
  const xLo = v[x] as number;
  const yLo = v[y] as number;
  const productLo = Math.imul(xLo, yLo) >>> 0;
  const lo = xLo + yLo + ((productLo << 1) >>> 0);
  v[x] = lo;
  v[x + 1] =
    (v[x + 1] as number) +
    (v[y + 1] as number) +
    (a2_mulHi(xLo, yLo) << 1) +
    (productLo >>> 31) +
    Math.floor(lo / 0x100000000);
}

// Word x = rotr64(word x ^ word y, n).
function a2_xorRotr(v: Uint32Array, x: number, y: number, n: number): void {
  const lo = (v[x] as number) ^ (v[y] as number);
  const hi = (v[x + 1] as number) ^ (v[y + 1] as number);
  if (n === 32) {
    v[x] = hi;
    v[x + 1] = lo;
  } else if (n < 32) {
    v[x] = (lo >>> n) | (hi << (32 - n));
    v[x + 1] = (hi >>> n) | (lo << (32 - n));
  } else {
    v[x] = (hi >>> (n - 32)) | (lo << (64 - n));
    v[x + 1] = (lo >>> (n - 32)) | (hi << (64 - n));
  }
}

// GB, the modified BLAKE2b mixing function with multiplications (Section 3.6).
function a2_gb(v: Uint32Array, a: number, b: number, c: number, d: number): void {
  a2_blamka(v, a, b);
  a2_xorRotr(v, d, a, 32);
  a2_blamka(v, c, d);
  a2_xorRotr(v, b, c, 24);
  a2_blamka(v, a, b);
  a2_xorRotr(v, d, a, 16);
  a2_blamka(v, c, d);
  a2_xorRotr(v, b, c, 63);
}

// Permutation P applied to the 16 words named by `q` (RFC 9106, Section 3.6).
function a2_permute(v: Uint32Array, q: number[]): void {
  const i = (k: number): number => q[k] as number;
  a2_gb(v, i(0), i(4), i(8), i(12));
  a2_gb(v, i(1), i(5), i(9), i(13));
  a2_gb(v, i(2), i(6), i(10), i(14));
  a2_gb(v, i(3), i(7), i(11), i(15));
  a2_gb(v, i(0), i(5), i(10), i(15));
  a2_gb(v, i(1), i(6), i(11), i(12));
  a2_gb(v, i(2), i(7), i(8), i(13));
  a2_gb(v, i(3), i(4), i(9), i(14));
}

// Scratch for every G call; Argon2 runs synchronously, so no two calls share them at once.
const A2_R = new Uint32Array(A2_HALVES_PER_BLOCK);
const A2_TMP = new Uint32Array(A2_HALVES_PER_BLOCK);

// G (RFC 9106 §3.5): next = (with_xor?next:0) XOR R XOR P_columns(P_rows(R)), where R=ref XOR prev.
function a2_fillBlock(
  prev: Uint32Array,
  ref: Uint32Array,
  next: Uint32Array,
  withXor: boolean,
): void {
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    const r = (ref[k] as number) ^ (prev[k] as number);
    A2_R[k] = r;
    A2_TMP[k] = withXor ? r ^ (next[k] as number) : r;
  }
  for (let i = 0; i < 8; i++) {
    a2_permute(A2_R, A2_ROWS[i] as number[]);
  }
  for (let i = 0; i < 8; i++) {
    a2_permute(A2_R, A2_COLS[i] as number[]);
  }
  for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
    next[k] = (A2_TMP[k] as number) ^ (A2_R[k] as number);
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

// Run the full Argon2 operation and return the tag.
export function argon2Core(params: CoreParams): Uint8Array {
  const { password, salt, secret, associatedData } = params;
  const lanes = params.parallelism;
  const memory = params.memory;
  const passes = params.iterations;
  const tagLength = params.tagLength;
  const version = params.version;
  const type = params.type;

  // Step 1: H_0.
  const h0 = blake2b(
    64,
    a2_concatBytes(
      a2_le32(lanes),
      a2_le32(tagLength),
      a2_le32(memory),
      a2_le32(passes),
      a2_le32(version),
      a2_le32(type),
      a2_le32(password.length),
      password,
      a2_le32(salt.length),
      salt,
      a2_le32(secret.length),
      secret,
      a2_le32(associatedData.length),
      associatedData,
    ),
  );

  // Step 2: allocate memory matrix B[lanes][columns].
  const memoryBlocks = 4 * lanes * Math.floor(memory / (4 * lanes));
  const columns = memoryBlocks / lanes;
  const segmentLength = columns / A2_SYNC_POINTS;
  const store = new Uint32Array(memoryBlocks * A2_HALVES_PER_BLOCK);

  const block = (lane: number, col: number): Uint32Array => {
    const start = (lane * columns + col) * A2_HALVES_PER_BLOCK;
    return store.subarray(start, start + A2_HALVES_PER_BLOCK);
  };

  // Steps 3-4: first two columns of each lane.
  for (let lane = 0; lane < lanes; lane++) {
    a2_bytesToBlock(a2_hPrime(1024, a2_concatBytes(h0, a2_le32(0), a2_le32(lane))), block(lane, 0));
    a2_bytesToBlock(a2_hPrime(1024, a2_concatBytes(h0, a2_le32(1), a2_le32(lane))), block(lane, 1));
  }

  const zeroBlock = new Uint32Array(A2_HALVES_PER_BLOCK);

  const fillSegment = (pass: number, slice: number, lane: number): void => {
    const dataIndependent = type === ARGON2_ID && pass === 0 && slice < A2_SYNC_POINTS / 2;

    let addressBlock = zeroBlock;
    let inputBlock = zeroBlock;
    const nextAddresses = (): void => {
      inputBlock[12] = (inputBlock[12] as number) + 1; // word 6, the counter
      a2_fillBlock(zeroBlock, inputBlock, addressBlock, false);
      a2_fillBlock(zeroBlock, addressBlock, addressBlock, false);
    };

    if (dataIndependent) {
      addressBlock = new Uint32Array(A2_HALVES_PER_BLOCK);
      inputBlock = new Uint32Array(A2_HALVES_PER_BLOCK);
      inputBlock[0] = pass;
      inputBlock[2] = lane;
      inputBlock[4] = slice;
      inputBlock[6] = memoryBlocks;
      inputBlock[8] = passes;
      inputBlock[10] = type;
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
      let at: number;
      if (dataIndependent) {
        if (index % A2_ADDRESSES_PER_BLOCK === 0) {
          nextAddresses();
        }
        source = addressBlock;
        at = 2 * (index % A2_ADDRESSES_PER_BLOCK);
      } else {
        source = block(lane, prevCol);
        at = 0;
      }
      const j1 = source[at] as number;
      const j2 = source[at + 1] as number;

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
      a2_fillBlock(block(lane, prevCol), block(refLane, refIndex), block(lane, col), withXor);
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

  // Step 7: final block C is the XOR of the last column across lanes.
  const c = new Uint32Array(A2_HALVES_PER_BLOCK);
  for (let lane = 0; lane < lanes; lane++) {
    const last = block(lane, columns - 1);
    for (let k = 0; k < A2_HALVES_PER_BLOCK; k++) {
      c[k] = (c[k] as number) ^ (last[k] as number);
    }
  }

  // Step 8: tag = H'^T(C).
  return a2_hPrime(tagLength, a2_blockToBytes(c));
}
