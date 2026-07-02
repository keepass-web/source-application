/**
 * Byte-level primitives shared by the KDBX reader and writer.
 *
 * The KDBX format stores all integers in little-endian byte order; the readers
 * and writers below honour that. 64-bit integers are surfaced as `bigint` so
 * that values above 2^53 (e.g. large KDF iteration counts) round-trip exactly.
 */

const kx_textEncoder = new TextEncoder();
const kx_textDecoder = new TextDecoder('utf-8', { fatal: false });

/** Encode a string as UTF-8 bytes (no BOM, no null terminator). */
export function utf8Encode(value: string): Uint8Array {
  return kx_textEncoder.encode(value);
}

/** Decode UTF-8 bytes to a string. */
export function utf8Decode(bytes: Uint8Array): string {
  return kx_textDecoder.decode(bytes);
}

/** Concatenate byte arrays into a single new array. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
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

/** Whether two byte arrays have identical contents. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Constant-time comparison of two byte arrays of equal length.
 *
 * Used for verifying HMAC tags, where short-circuiting on the first differing
 * byte would leak timing information.
 */
export function bytesEqualConstantTime(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Lowercase hexadecimal encoding. */
export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** Decode a hexadecimal string (whitespace is ignored). */
export function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hex string must have an even number of digits');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('invalid hex digit');
    }
    out[i] = byte;
  }
  return out;
}

const KX_BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const KX_BASE64_LOOKUP: Int16Array = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < KX_BASE64_CHARS.length; i += 1) {
    table[KX_BASE64_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Standard Base64 encoding (RFC 4648). Implemented directly so that the same
 * code runs in browsers and in Node without depending on `btoa`/`Buffer`.
 */
export function toBase64(bytes: Uint8Array): string {
  const c = (index: number): string => KX_BASE64_CHARS.charAt(index);
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += c((n >> 18) & 63) + c((n >> 12) & 63) + c((n >> 6) & 63) + c(n & 63);
  }
  const remaining = bytes.length - i;
  if (remaining === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += `${c((n >> 18) & 63)}${c((n >> 12) & 63)}==`;
  } else if (remaining === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += `${c((n >> 18) & 63)}${c((n >> 12) & 63)}${c((n >> 6) & 63)}=`;
  }
  return out;
}

/** Decode a standard Base64 string (whitespace is ignored). */
export function fromBase64(value: string): Uint8Array {
  const clean = value.replace(/\s+/g, '');
  if (clean.length === 0) {
    return new Uint8Array(0);
  }
  let length = clean.length;
  let padding = 0;
  if (clean.endsWith('==')) {
    padding = 2;
  } else if (clean.endsWith('=')) {
    padding = 1;
  }
  length -= padding;
  const outLength = Math.floor((length * 6) / 8);
  const out = new Uint8Array(outLength);
  let bits = 0;
  let value32 = 0;
  let outIndex = 0;
  for (let i = 0; i < length; i += 1) {
    const code = KX_BASE64_LOOKUP[clean.charCodeAt(i)] ?? -1;
    if (code < 0) {
      throw new Error('invalid base64 character');
    }
    value32 = (value32 << 6) | code;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (value32 >> bits) & 0xff;
      outIndex += 1;
    }
  }
  return out;
}

/** Sequential little-endian reader over a byte buffer. */
export class ByteReader {
  readonly #view: DataView;
  readonly #bytes: Uint8Array;
  #offset = 0;

  constructor(bytes: Uint8Array) {
    this.#bytes = bytes;
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Number of bytes consumed so far. */
  get offset(): number {
    return this.#offset;
  }

  /** Number of bytes not yet consumed. */
  get remaining(): number {
    return this.#bytes.length - this.#offset;
  }

  #require(count: number): void {
    if (this.#offset + count > this.#bytes.length) {
      throw new RangeError(
        `unexpected end of data: needed ${count} byte(s) at offset ${this.#offset}`,
      );
    }
  }

  /** Read `count` bytes as a copy. */
  readBytes(count: number): Uint8Array {
    this.#require(count);
    const out = this.#bytes.slice(this.#offset, this.#offset + count);
    this.#offset += count;
    return out;
  }

  readU8(): number {
    this.#require(1);
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  readU16(): number {
    this.#require(2);
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  readU32(): number {
    this.#require(4);
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  readI32(): number {
    this.#require(4);
    const value = this.#view.getInt32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  readU64(): bigint {
    this.#require(8);
    const value = this.#view.getBigUint64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  readI64(): bigint {
    this.#require(8);
    const value = this.#view.getBigInt64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  /** Read all remaining bytes as a copy. */
  readRest(): Uint8Array {
    return this.readBytes(this.remaining);
  }
}

/** Growable little-endian byte writer. */
export class ByteWriter {
  #buffer: Uint8Array;
  #length = 0;

  constructor(initialCapacity = 256) {
    this.#buffer = new Uint8Array(initialCapacity);
  }

  get length(): number {
    return this.#length;
  }

  #ensure(extra: number): void {
    const needed = this.#length + extra;
    if (needed <= this.#buffer.length) {
      return;
    }
    let capacity = this.#buffer.length * 2;
    while (capacity < needed) {
      capacity *= 2;
    }
    const next = new Uint8Array(capacity);
    next.set(this.#buffer.subarray(0, this.#length));
    this.#buffer = next;
  }

  writeBytes(bytes: Uint8Array): this {
    this.#ensure(bytes.length);
    this.#buffer.set(bytes, this.#length);
    this.#length += bytes.length;
    return this;
  }

  writeU8(value: number): this {
    this.#ensure(1);
    this.#buffer[this.#length] = value & 0xff;
    this.#length += 1;
    return this;
  }

  writeU16(value: number): this {
    this.#ensure(2);
    new DataView(this.#buffer.buffer).setUint16(this.#length, value, true);
    this.#length += 2;
    return this;
  }

  writeU32(value: number): this {
    this.#ensure(4);
    new DataView(this.#buffer.buffer).setUint32(this.#length, value >>> 0, true);
    this.#length += 4;
    return this;
  }

  writeI32(value: number): this {
    this.#ensure(4);
    new DataView(this.#buffer.buffer).setInt32(this.#length, value, true);
    this.#length += 4;
    return this;
  }

  writeU64(value: bigint): this {
    this.#ensure(8);
    new DataView(this.#buffer.buffer).setBigUint64(this.#length, value, true);
    this.#length += 8;
    return this;
  }

  writeI64(value: bigint): this {
    this.#ensure(8);
    new DataView(this.#buffer.buffer).setBigInt64(this.#length, value, true);
    this.#length += 8;
    return this;
  }

  /** Return the written bytes as a right-sized copy. */
  toBytes(): Uint8Array {
    return this.#buffer.slice(0, this.#length);
  }
}
