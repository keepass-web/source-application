/**
 * `argon2` — Argon2d and Argon2id key derivation per
 * [RFC 9106](https://www.rfc-editor.org/rfc/rfc9106).
 *
 * Argon2i is intentionally not implemented (see README.md); RFC 9106 requires
 * only Argon2id, and KDBX 4.x uses Argon2d or Argon2id.
 */

import { ARGON2_D, ARGON2_ID, ARGON2_VERSION_13, argon2Core } from './argon2.ts';

const A2_MAX_U24 = 0xffffff;
const A2_MAX_U32 = 0xffffffff;
const A2_EMPTY = new Uint8Array(0);

/** Argon2 variant. */
export type Argon2Type = 'argon2d' | 'argon2id';

/** Options for {@link argon2}. Parameter names and bounds follow RFC 9106. */
export interface Argon2Options {
  /** Message P. For KDBX this is the composite key. */
  password: Uint8Array;
  /** Nonce S (salt). */
  salt: Uint8Array;
  /** Degree of parallelism p (lanes), an integer in 1..2^24-1. */
  parallelism: number;
  /** Memory size m in KiB, an integer in 8*parallelism..2^32-1. */
  memory: number;
  /** Number of passes t, an integer in 1..2^32-1. */
  iterations: number;
  /** Desired tag length T in bytes, an integer in 4..2^32-1. */
  tagLength: number;
  /** Variant to use. */
  type: Argon2Type;
  /** Optional secret value K. */
  secret?: Uint8Array;
  /** Optional associated data X. */
  associatedData?: Uint8Array;
  /** Version number; defaults to 0x13 (the current version). */
  version?: number;
}

/** Options for {@link argon2d} / {@link argon2id} (no `type` field). */
export type Argon2VariantOptions = Omit<Argon2Options, 'type'>;

function a2_requireInteger(name: string, value: number, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer in ${min}..${max}, got ${value}`);
  }
}

function a2_requireBytes(name: string, value: Uint8Array): void {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${name} must be a Uint8Array`);
  }
  if (value.length > A2_MAX_U32) {
    throw new RangeError(`${name} must be at most 2^32-1 bytes`);
  }
}

/**
 * Derive a key with Argon2d or Argon2id (RFC 9106).
 *
 * @returns the raw tag of `tagLength` bytes.
 */
export function argon2(options: Argon2Options): Uint8Array {
  const { password, salt, type } = options;
  const secret = options.secret ?? A2_EMPTY;
  const associatedData = options.associatedData ?? A2_EMPTY;
  const version = options.version ?? ARGON2_VERSION_13;

  if (type !== 'argon2d' && type !== 'argon2id') {
    throw new RangeError(`type must be 'argon2d' or 'argon2id', got ${String(type)}`);
  }
  if (version !== 0x10 && version !== 0x13) {
    throw new RangeError(`version must be 0x10 or 0x13, got ${version}`);
  }
  a2_requireBytes('password', password);
  a2_requireBytes('salt', salt);
  a2_requireBytes('secret', secret);
  a2_requireBytes('associatedData', associatedData);
  a2_requireInteger('parallelism', options.parallelism, 1, A2_MAX_U24);
  a2_requireInteger('iterations', options.iterations, 1, A2_MAX_U32);
  a2_requireInteger('tagLength', options.tagLength, 4, A2_MAX_U32);
  a2_requireInteger('memory', options.memory, 8 * options.parallelism, A2_MAX_U32);

  return argon2Core({
    password,
    salt,
    secret,
    associatedData,
    parallelism: options.parallelism,
    memory: options.memory,
    iterations: options.iterations,
    tagLength: options.tagLength,
    version,
    type: type === 'argon2id' ? ARGON2_ID : ARGON2_D,
  });
}

/** Derive a key with Argon2d. Equivalent to `argon2({ ...options, type: 'argon2d' })`. */
export function argon2d(options: Argon2VariantOptions): Uint8Array {
  return argon2({ ...options, type: 'argon2d' });
}

/** Derive a key with Argon2id. Equivalent to `argon2({ ...options, type: 'argon2id' })`. */
export function argon2id(options: Argon2VariantOptions): Uint8Array {
  return argon2({ ...options, type: 'argon2id' });
}
