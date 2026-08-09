/**
 * Ambient declarations for the globals bundle.js injects into the page.
 *
 * bundle-iife concatenates packages/router, packages/embed-protocol, this
 * page's own pure logic (logic.ts), and page.ts's own compiled output into
 * one IIFE, then hoists the names below onto globalThis — one entry per name
 * in bundle-iife.json's "exports" list, matching what
 * tests/local-page.test.ts sets up by hand.
 *
 * This file exists only so page.ts can be type-checked against that surface;
 * it declares only the members page.ts actually calls, mirroring the
 * corresponding signatures in packages/router/src, packages/embed-protocol/src,
 * and logic.ts.
 */

declare function identifyFormat(
  header: Uint8Array,
):
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; implementation?: string };

interface ReadyMessage {
  type: 'kw-ready';
}
interface OpenMessage {
  type: 'kw-open';
  filename: string;
  bytes: ArrayBuffer;
}
interface CreateMessage {
  type: 'kw-create';
}
interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}
interface SavedMessage {
  type: 'kw-saved';
  ok: boolean;
  error?: string;
}
interface CloseRequestMessage {
  type: 'kw-close-request';
}
interface CloseAckMessage {
  type: 'kw-close-ack';
}
interface CloseMessage {
  type: 'kw-close';
}

declare function isReadyMessage(data: unknown): data is ReadyMessage;
declare function isSaveMessage(data: unknown): data is SaveMessage;
declare function isCloseAckMessage(data: unknown): data is CloseAckMessage;
declare function isCloseMessage(data: unknown): data is CloseMessage;
declare function openMessage(filename: string, bytes: ArrayBuffer): OpenMessage;
declare function createMessage(): CreateMessage;
declare function savedMessage(ok: boolean, error?: string): SavedMessage;
declare function closeRequestMessage(): CloseRequestMessage;

declare function must<T>(value: T | null | undefined): T;
