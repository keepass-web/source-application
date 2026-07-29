/**
 * `embed-protocol` — the same-origin postMessage contract between a
 * keepass-web implementation (currently only `0x67`) and whatever host page
 * embeds it in an iframe (the local-file chooser, the Google Drive
 * connector, and future sources).
 *
 * Message shapes and guards used to be hand-written twice: once inline in
 * 0x67/page.ts (the app side) and once in each host's own logic.ts (the host
 * side). Nothing but manual care kept those two hand-written copies in sync.
 * Centralizing both the guards *and* the builders here means the two ends of
 * the protocol are provably using the same wire format, not just similarly
 * shaped code.
 *
 * Six message types, each read by exactly one side and built by the other:
 *   app  → host : kw-ready          (built by the app, read by the host)
 *   host → app  : kw-open           (built by the host, read by the app)
 *   app  → host : kw-save           (built by the app, read by the host)
 *   host → app  : kw-saved          (built by the host, read by the app)
 *   host → app  : kw-close-request  (built by the host, read by the app)
 *   app  → host : kw-close-ack      (built by the app, read by the host)
 *   app  → host : kw-close          (built by the app, read by the host)
 */

export interface ReadyMessage {
  type: 'kw-ready';
}

export interface OpenMessage {
  type: 'kw-open';
  filename: string;
  bytes: ArrayBuffer;
}

export interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}

export interface SavedMessage {
  type: 'kw-saved';
  ok: boolean;
  error?: string;
}

export interface CloseRequestMessage {
  type: 'kw-close-request';
}

export interface CloseAckMessage {
  type: 'kw-close-ack';
}

export interface CloseMessage {
  type: 'kw-close';
}

function hasType(data: unknown, type: string): data is { type: string } {
  return (
    data !== null && typeof data === 'object' && (data as Record<string, unknown>).type === type
  );
}

function isFileMessage(
  data: unknown,
  type: 'kw-open' | 'kw-save',
): data is { type: string; filename: string; bytes: ArrayBuffer } {
  if (!hasType(data, type)) return false;
  const rec = data as Record<string, unknown>;
  return typeof rec.filename === 'string' && rec.bytes instanceof ArrayBuffer;
}

// --- Guards ------------------------------------------------------------

export function isReadyMessage(data: unknown): data is ReadyMessage {
  return hasType(data, 'kw-ready');
}

export function isOpenMessage(data: unknown): data is OpenMessage {
  return isFileMessage(data, 'kw-open');
}

export function isSaveMessage(data: unknown): data is SaveMessage {
  return isFileMessage(data, 'kw-save');
}

export function isSavedMessage(data: unknown): data is SavedMessage {
  if (!hasType(data, 'kw-saved')) return false;
  const rec = data as Record<string, unknown>;
  if (typeof rec.ok !== 'boolean') return false;
  return rec.error === undefined || typeof rec.error === 'string';
}

export function isCloseRequestMessage(data: unknown): data is CloseRequestMessage {
  return hasType(data, 'kw-close-request');
}

export function isCloseAckMessage(data: unknown): data is CloseAckMessage {
  return hasType(data, 'kw-close-ack');
}

export function isCloseMessage(data: unknown): data is CloseMessage {
  return hasType(data, 'kw-close');
}

// --- Builders ------------------------------------------------------------

export function readyMessage(): ReadyMessage {
  return { type: 'kw-ready' };
}

export function openMessage(filename: string, bytes: ArrayBuffer): OpenMessage {
  return { type: 'kw-open', filename, bytes };
}

export function saveMessage(filename: string, bytes: ArrayBuffer): SaveMessage {
  return { type: 'kw-save', filename, bytes };
}

export function savedMessage(ok: boolean, error?: string): SavedMessage {
  return error === undefined ? { type: 'kw-saved', ok } : { type: 'kw-saved', ok, error };
}

export function closeRequestMessage(): CloseRequestMessage {
  return { type: 'kw-close-request' };
}

export function closeAckMessage(): CloseAckMessage {
  return { type: 'kw-close-ack' };
}

export function closeMessage(): CloseMessage {
  return { type: 'kw-close' };
}
