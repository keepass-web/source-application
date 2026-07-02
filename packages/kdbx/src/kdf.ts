/**
 * Key derivation functions used by KDBX to transform the composite key.
 *
 * - KDBX 3.1 always uses AES-KDF, parameterized by the outer-header transform
 *   seed and round count.
 * - KDBX 4.x stores the KDF choice and parameters in a VariantDictionary; the
 *   built-in functions are AES-KDF, Argon2d, and Argon2id.
 */

import { type Argon2Type, argon2 } from '../../argon2/dist/src/index.js';
import { bytesEqual } from './bytes.ts';
import { Argon2Version, KdfId, KdfParam } from './constants.ts';
import { aesKdfTransform } from './crypto.ts';
import { type VariantDictionary, vdRequireBytes, vdRequireInt } from './variant-dictionary.ts';

const KX_ARGON2_TAG_LENGTH = 32;
const KX_BYTES_PER_KIB = 1024n;

/** Transform a 32-byte composite key with AES-KDF (KDBX 3.1 and the AES-KDF KDF). */
export async function aesKdf(
  compositeKey: Uint8Array,
  seed: Uint8Array,
  rounds: bigint,
): Promise<Uint8Array> {
  return aesKdfTransform(compositeKey, seed, rounds);
}

/**
 * Transform a composite key using the KDF described by a KDBX 4.x KDF-parameter
 * VariantDictionary.
 */
export async function transformWithKdfParameters(
  compositeKey: Uint8Array,
  params: VariantDictionary,
): Promise<Uint8Array> {
  const uuid = vdRequireBytes(params, KdfParam.Uuid);

  if (bytesEqual(uuid, KdfId.Aes)) {
    const seed = vdRequireBytes(params, KdfParam.AesSeed);
    const rounds = vdRequireInt(params, KdfParam.AesRounds);
    return aesKdfTransform(compositeKey, seed, rounds);
  }

  const argonType = kx_argon2TypeFor(uuid);
  if (argonType !== undefined) {
    return kx_runArgon2(compositeKey, params, argonType);
  }

  throw new Error('unsupported KDF UUID in KDF parameters');
}

function kx_argon2TypeFor(uuid: Uint8Array): Argon2Type | undefined {
  if (bytesEqual(uuid, KdfId.Argon2d)) {
    return 'argon2d';
  }
  if (bytesEqual(uuid, KdfId.Argon2id)) {
    return 'argon2id';
  }
  return undefined;
}

function kx_runArgon2(
  compositeKey: Uint8Array,
  params: VariantDictionary,
  type: Argon2Type,
): Uint8Array {
  const salt = vdRequireBytes(params, KdfParam.Argon2Salt);
  const parallelism = Number(vdRequireInt(params, KdfParam.Argon2Parallelism));
  const iterations = Number(vdRequireInt(params, KdfParam.Argon2Iterations));
  // KDBX stores memory in bytes; RFC 9106 / the argon2 package take KiB.
  const memoryBytes = vdRequireInt(params, KdfParam.Argon2Memory);
  const memory = Number(memoryBytes / KX_BYTES_PER_KIB);

  const versionParam = params.get(KdfParam.Argon2Version);
  const version =
    versionParam === undefined
      ? Argon2Version.V13
      : Number(vdRequireInt(params, KdfParam.Argon2Version));

  const secret = kx_optionalBytes(params, KdfParam.Argon2Secret);
  const associatedData = kx_optionalBytes(params, KdfParam.Argon2AssocData);

  return argon2({
    password: compositeKey,
    salt,
    parallelism,
    memory,
    iterations,
    tagLength: KX_ARGON2_TAG_LENGTH,
    version,
    type,
    ...(secret ? { secret } : {}),
    ...(associatedData ? { associatedData } : {}),
  });
}

function kx_optionalBytes(params: VariantDictionary, name: string): Uint8Array | undefined {
  const value = params.get(name);
  return value?.type === 'bytes' ? value.value : undefined;
}
