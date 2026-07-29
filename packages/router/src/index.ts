/**
 * `router` — identifies a KDBX-family file from its first 8 bytes and names
 * the implementation (a page like `0x67.html`) that reads it.
 *
 * This package is shared, unmodified, across every chooser page (local file,
 * Google Drive, and future sources): the decision "which implementation
 * understands these bytes" doesn't depend on where the bytes came from, so
 * it lives once here rather than being re-decided per chooser.
 *
 * Deliberately does not import `kdbx`: its whole job is routing based on 8
 * bytes, and it stays independently auditable by owning that logic outright
 * rather than pulling in the full parser to do it.
 */

/** First 32-bit signature shared by every KDBX-family file (little-endian on disk). */
const SIGNATURE_1 = 0x9aa2d903;

/**
 * Top three bytes shared by every KDBX-family secondary signature; the low
 * byte identifies the sub-format (see KNOWN_SECONDARY_SIGNATURES).
 */
const SIGNATURE_2_PREFIX = 0xb54bfb00;

/**
 * Sub-formats identified by the secondary signature's low byte. `implementation`
 * is present only for a format this app actually has a reader for, and names
 * the page a chooser should embed to open it — not a page to navigate to.
 *
 * A Map, not a plain object, specifically so the keys can stay hexadecimal
 * literals (matching how the format's own spec refers to them) without
 * tripping Biome's useSimpleNumberKeys rule, which only applies to object
 * literal keys.
 */
const KNOWN_SECONDARY_SIGNATURES: ReadonlyMap<number, { label: string; implementation?: string }> =
  new Map([
    [0x65, { label: 'KeePass 1.x (.kdb)' }],
    [0x66, { label: 'KDBX pre-release' }],
    [0x67, { label: 'KDBX 3.1 / 4.x', implementation: '0x67.html' }],
  ]);

export type FormatResult =
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; implementation?: string };

/**
 * Identify a KDBX-family file from its first 8 bytes alone: the two
 * signature UInt32s. Reads nothing else — the router's whole job is
 * routing, not parsing.
 */
export function identifyFormat(header: Uint8Array): FormatResult {
  if (header.length < 8) {
    return { kind: 'invalid' };
  }

  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint32(0, true) !== SIGNATURE_1) {
    return { kind: 'invalid' };
  }

  const signature2 = view.getUint32(4, true);
  if ((signature2 & 0xffffff00) >>> 0 !== SIGNATURE_2_PREFIX) {
    return { kind: 'invalid' };
  }

  const secondaryByte = signature2 & 0xff;
  const known = KNOWN_SECONDARY_SIGNATURES.get(secondaryByte);
  if (known) {
    return { kind: 'recognized', secondaryByte, ...known };
  }

  const hex = secondaryByte.toString(16).padStart(2, '0');
  return {
    kind: 'recognized',
    secondaryByte,
    label: `unknown KDBX variant (secondary signature 0x${hex})`,
  };
}
