/** Composite master key: SHA-256(password) then key-file bytes, concatenated
and SHA-256'd, in that fixed order. (Key-provider plugins/DPAPI: out of scope.) */

import { concatBytes, fromBase64, fromHex, toHex, utf8Encode } from './bytes.ts';
import { sha256 } from './crypto.ts';

// Inputs accepted when constructing {@link Credentials}.
export interface CredentialsInput {
  // Master password, as text or as raw bytes.
  password?: string | Uint8Array;
  // Key file contents (raw bytes of the file on disk).
  keyFile?: Uint8Array;
}

/** A set of credentials from which a composite key can be derived. It keeps its own copies of
the password and key file, so wipe() zeroes those without touching the caller's (#145). */
export class Credentials {
  readonly #password: Uint8Array | undefined;
  readonly #keyFile: Uint8Array | undefined;
  #wiped = false;

  constructor(input: CredentialsInput) {
    if (input.password === undefined && input.keyFile === undefined) {
      throw new Error('credentials require a password and/or a key file');
    }
    this.#password =
      typeof input.password === 'string' ? utf8Encode(input.password) : input.password?.slice();
    this.#keyFile = input.keyFile?.slice();
  }

  // Convenience constructor for a password-only credential.
  static fromPassword(password: string): Credentials {
    return new Credentials({ password });
  }

  // Compute the 32-byte composite key for these credentials.
  async getCompositeKey(): Promise<Uint8Array> {
    // Refused, not derived from the zeros, so nothing is ever sealed under an all-zero key (#145).
    if (this.#wiped) throw new Error('credentials were wiped and can no longer derive a key');
    const components: Uint8Array[] = [];
    let joined: Uint8Array = new Uint8Array(0);
    try {
      if (this.#password !== undefined) {
        components.push(await sha256(this.#password));
      }
      if (this.#keyFile !== undefined) {
        components.push(await keyFileComponent(this.#keyFile));
      }
      joined = concatBytes(...components);
      return await sha256(joined);
    } finally {
      for (const component of components) component.fill(0);
      joined.fill(0);
    }
  }

  // Zero the password and key file once these credentials are no longer needed.
  wipe(): void {
    this.#password?.fill(0);
    this.#keyFile?.fill(0);
    this.#wiped = true;
  }
}

const KX_HEX_64 = /^[0-9a-fA-F]{64}$/;

// Derive the 32-byte key-file component, mirroring KeePass's detection order.
export async function keyFileComponent(bytes: Uint8Array): Promise<Uint8Array> {
  const xmlKey = await kx_tryParseXmlKeyFile(bytes);
  if (xmlKey !== undefined) {
    return xmlKey;
  }
  if (bytes.length === 32) {
    return bytes.slice();
  }
  // Hex only at exactly 64 characters, as KeePass and KeePassXC read it (#128).
  if (bytes.length === 64) {
    const text = new TextDecoder('ascii').decode(bytes);
    if (KX_HEX_64.test(text)) {
      return fromHex(text);
    }
  }
  return sha256(bytes);
}

/** Parse a KeePass XML key file. v2.x hex-encodes the key with a `Data
Hash` corruption check; v1.x is unchecked Base64. `undefined` if not XML. */
async function kx_tryParseXmlKeyFile(bytes: Uint8Array): Promise<Uint8Array | undefined> {
  const text = kx_tryDecodeUtf8(bytes);
  if (text === undefined || !text.includes('<KeyFile')) {
    return undefined;
  }
  const dataMatch = text.match(/<Data\b([^>]*)>([\s\S]*?)<\/Data>/);
  if (!dataMatch?.[2]) {
    return undefined;
  }
  const data = dataMatch[2].replace(/\s+/g, '');
  const versionMatch = text.match(/<Version>([^<]+)<\/Version>/);
  const version = (versionMatch?.[1] ?? '1.0').trim();
  if (!version.startsWith('2')) {
    return fromBase64(data);
  }

  const key = fromHex(data);
  // Always captured alongside dataMatch[2]; cast only satisfies noUncheckedIndexedAccess.
  const hashMatch = (dataMatch[1] as string).match(/\bHash="([0-9a-fA-F]+)"/);
  if (hashMatch?.[1] !== undefined) {
    const expectedHash = hashMatch[1].toLowerCase();
    const digest = await sha256(key);
    const actualHash = toHex(digest.subarray(0, 4));
    digest.fill(0);
    if (actualHash !== expectedHash) {
      key.fill(0);
      throw new Error('key file is corrupt (checksum mismatch)');
    }
  }
  return key;
}

function kx_tryDecodeUtf8(bytes: Uint8Array): string | undefined {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
