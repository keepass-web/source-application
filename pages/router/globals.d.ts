/**
 * Ambient declarations for the globals bundle.js injects into the page.
 *
 * bundle.js concatenates this page's own pure logic (identifyFormat and
 * must, extracted from page.ts into logic.ts so they can be unit tested
 * without a DOM) with page.ts's own compiled output into one IIFE — see
 * bundle-iife.json's "files" list. It also exposes both names as globals via
 * `globalThis.<name> = <name>`, one entry per name in bundle-iife.json's
 * "exports" list, matching what pages/tests/router-page.test.ts sets up by
 * hand.
 *
 * This file exists only so page.ts can be type-checked against that
 * surface; it declares only the members page.ts actually calls, mirroring
 * the corresponding signatures in logic.ts.
 */

type FormatResult =
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; page?: string };

declare function identifyFormat(header: Uint8Array): FormatResult;
declare function must<T>(value: T | null | undefined): T;
