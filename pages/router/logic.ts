/**
 * Pure logic for the router: format detection from a file's first 8 bytes,
 * plus the same must()-style "fail loudly on a missing DOM node" guard
 * page.ts needs. None of this touches the DOM, so unlike page.ts it can be —
 * and is — unit tested directly under plain Node (see
 * tests/router-logic.test.ts).
 *
 * This is a real ES module, exactly like 0x67/logic.ts, so ordinary imports
 * work in tests. For the browser build, bundle-iife strips the `export`
 * keyword below and hoists these names onto globalThis — see
 * router/bundle-iife.json. page.ts consumes them as globals, not via import
 * — see globals.d.ts.
 *
 * The router deliberately does not import packages/kdbx: its whole job is
 * routing based on 8 bytes, and it stays independently auditable by owning
 * that logic outright rather than pulling in the full parser to do it.
 */

/** First 32-bit signature shared by every KDBX-family file (little-endian on disk). */
const SIGNATURE_1 = 0x9aa2d903;

/**
 * Top three bytes shared by every KDBX-family secondary signature; the low
 * byte identifies the sub-format (see KNOWN_SECONDARY_SIGNATURES).
 */
const SIGNATURE_2_PREFIX = 0xb54bfb00;

/**
 * Sub-formats identified by the secondary signature's low byte. `page` is
 * present only for a format this app actually has a reader for.
 *
 * A Map, not a plain object, specifically so the keys can stay hexadecimal
 * literals (matching how the format's own spec and packages/kdbx/src/constants.ts
 * refer to them) without tripping Biome's useSimpleNumberKeys rule, which
 * only applies to object literal keys.
 */
const KNOWN_SECONDARY_SIGNATURES: ReadonlyMap<number, { label: string; page?: string }> = new Map([
  [0x65, { label: 'KeePass 1.x (.kdb)' }],
  [0x66, { label: 'KDBX pre-release' }],
  [0x67, { label: 'KDBX 3.1 / 4.x', page: '0x67.html' }],
]);

export type FormatResult =
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; page?: string };

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

/**
 * Unwrap a possibly-missing DOM lookup, or fail loudly. page.ts's markup is
 * static and hand-authored, so a missing element means a real bug, not a
 * state to handle gracefully.
 *
 * Lives here rather than in page.ts itself (contrast 0x67/page.ts, which
 * defines its own copy): router has a single static screen, so there's no
 * later DOM mutation that naturally re-triggers a lookup the way 0x67's
 * repeated screen re-renders do, which makes testing the throw branch
 * through page.ts alone impractical. Keeping it here instead lets
 * tests/router-logic.test.ts exercise it directly.
 */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}
