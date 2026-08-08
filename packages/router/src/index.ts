/** `router` — identifies a KDBX-family file from its first 8 bytes and
names the implementation that reads it; shared, unmodified, by every
chooser page. Doesn't import `kdbx`, so it stays auditable on its own. */

// First 32-bit signature shared by every KDBX-family file (little-endian on disk).
const SIGNATURE_1 = 0x9aa2d903;

// Top 3 bytes shared by every secondary signature; the low byte identifies the sub-format.
const SIGNATURE_2_PREFIX = 0xb54bfb00;

/** Sub-formats by the secondary signature's low byte. `implementation` is
set only when this app can read the format, naming the page to embed
(not navigate to). A Map keeps keys as hex literals; Biome's
useSimpleNumberKeys only applies to object literals. */
const KNOWN_SECONDARY_SIGNATURES: ReadonlyMap<number, { label: string; implementation?: string }> =
  new Map([
    [0x65, { label: 'KeePass 1.x (.kdb)' }],
    [0x66, { label: 'KDBX pre-release' }],
    [0x67, { label: 'KDBX 3.1 / 4.x', implementation: '0x67.html' }],
  ]);

export type FormatResult =
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; implementation?: string };

// Identify a file from its first 8 bytes (the two signature UInt32s) alone — routing, not parsing.
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
