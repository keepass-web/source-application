/**
 * Ambient declarations for the globals bundle.js injects into the page.
 *
 * bundle-iife concatenates this page's own pure logic (logic.ts) and page.ts's
 * own compiled output into one IIFE. This file exists only so page.ts can be
 * type-checked against that surface; it declares only the members page.ts
 * actually calls, mirroring the corresponding signatures in logic.ts.
 */

declare function must<T>(value: T | null | undefined): T;
declare function verifyCommand(protocol: string, origin: string): string;
