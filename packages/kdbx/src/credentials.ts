/**
 * Composite master key assembly.
 *
 * KeePass builds the composite key by SHA-256-hashing the concatenation of the
 * key components the user provides, each in a fixed order: the SHA-256 of the
 * password, then the key drawn from a key file. (Key-provider plugins and the
 * Windows DPAPI component are out of scope here.)
 */

import { concatBytes, fromBase64, fromHex, toHex, utf8Encode } from './bytes.ts';
import { sha256 } from './crypto.ts';

/** Inputs accepted when constructing {@link Credentials}. */
export interface CredentialsInput {
  /** Master password, as text or as raw bytes. */
  password?: string | Uint8Array;
  /** Key file contents (raw bytes of the file on disk). */
  keyFile?: Uint8Array;
}

/** A set of credentials from which a composite key can be derived. */
export class Credentials {
  readonly #password: Uint8Array | undefined;
  readonly #keyFile: Uint8Array | undefined;

  constructor(input: CredentialsInput) {
    if (input.password === undefined && input.keyFile === undefined) {
      throw new Error('credentials require a password and/or a key file');
    }
    this.#password =
      typeof input.password === 'string' ? utf8Encode(input.password) : input.password;
    this.#keyFile = input.keyFile;
  }

  /** Convenience constructor for a password-only credential. */
  static fromPassword(password: string): Credentials {
    return new Credentials({ password });
  }

  /** Compute the 32-byte composite key for these credentials. */
  async getCompositeKey(): Promise<Uint8Array> {
    const components: Uint8Array[] = [];
    if (this.#password !== undefined) {
      components.push(await sha256(this.#password));
    }
    if (this.#keyFile !== undefined) {
      components.push(await keyFileComponent(this.#keyFile));
    }
    return sha256(concatBytes(...components));
  }
}

const KX_HEX_64 = /^[0-9a-fA-F]{64}$/;

/** Derive the 32-byte key-file component, mirroring KeePass's detection order. */
export async function keyFileComponent(bytes: Uint8Array): Promise<Uint8Array> {
  const xmlKey = await kx_tryParseXmlKeyFile(bytes);
  if (xmlKey !== undefined) {
    return xmlKey;
  }
  if (bytes.length === 32) {
    return bytes.slice();
  }
  const text = kx_tryDecodeAscii(bytes);
  if (text !== undefined && KX_HEX_64.test(text.trim())) {
    return fromHex(text.trim());
  }
  return sha256(bytes);
}

function kx_tryDecodeAscii(bytes: Uint8Array): string | undefined {
  for (const byte of bytes) {
    if (byte > 0x7e || (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d)) {
      return undefined;
    }
  }
  return new TextDecoder('ascii').decode(bytes);
}

/**
 * Parse a KeePass XML key file. Version 2.x stores the key as hex, and its
 * `<Data Hash="…">` attribute holds the first 4 bytes of SHA-256 of that key
 * (a corruption check, independent of whether the key opens any database);
 * version 1.x stores 32 bytes as Base64 with no such check. Returns
 * `undefined` if the bytes are not an XML key file.
 */
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
  const versionMatch = text.match(/<Version>\s*([^<]+?)\s*<\/Version>/);
  const version = versionMatch?.[1] ?? '1.0';
  if (!version.startsWith('2')) {
    return fromBase64(data);
  }

  const key = fromHex(data);
  // dataMatch[1] is the <Data ...> tag's attribute text, always captured
  // (possibly empty) whenever dataMatch[2] matched; the cast only satisfies
  // noUncheckedIndexedAccess.
  const hashMatch = (dataMatch[1] as string).match(/\bHash="([0-9a-fA-F]+)"/);
  if (hashMatch?.[1] !== undefined) {
    const expectedHash = hashMatch[1].toLowerCase();
    const actualHash = toHex((await sha256(key)).slice(0, 4));
    if (actualHash !== expectedHash) {
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
