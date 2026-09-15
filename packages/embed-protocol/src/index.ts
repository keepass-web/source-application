/** `embed-protocol` — the equivalent-origin postMessage contract between a
keepass-web implementation and whatever host embeds it in an iframe.
Centralizes shapes/guards/builders so both ends provably agree on the wire
format: kw-ready, kw-open, kw-create, kw-save, kw-saved, kw-title, kw-find,
kw-close-request, kw-close-ack, kw-close (#1), kw-reconnect, kw-reconnected (#85). */

export interface ReadyMessage {
  type: 'kw-ready';
}

export interface OpenMessage {
  type: 'kw-open';
  filename: string;
  bytes: ArrayBuffer;
}

// Host tells the app to start a brand-new, empty database instead of opening one.
export interface CreateMessage {
  type: 'kw-create';
}

export interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}

/* A failure the app must handle differently from a generic error, rather than
report as a status code; the host's credential expiring is recoverable in
place, so the app offers a reconnect instead (#85). */
export type SavedFailureReason = 'auth-expired';

export interface SavedMessage {
  type: 'kw-saved';
  ok: boolean;
  error?: string;
  reason?: SavedFailureReason;
}

/* The app asks its host to renew the credential a save just failed on. The app
re-sends the save itself once this succeeds, so the host never holds database
bytes across a user-paced reconnect (#85). */
export interface ReconnectMessage {
  type: 'kw-reconnect';
}

export interface ReconnectedMessage {
  type: 'kw-reconnected';
  ok: boolean;
  error?: string;
}

// The host document owns the tab title, so the app reports state rather than setting it (#65).
export interface TitleMessage {
  type: 'kw-title';
  filename: string;
  locked: boolean;
}

/* Whichever document has focus receives the keystroke, and outside the iframe
that is the host; it forwards the find rather than letting the browser's own
search the one page it can see (#78). */
export interface FindMessage {
  type: 'kw-find';
}

export interface CloseRequestMessage {
  type: 'kw-close-request';
}

// Receipt, not consent: the outcome follows as kw-close, or not at all if the user declines (#83).
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

export function isCreateMessage(data: unknown): data is CreateMessage {
  return hasType(data, 'kw-create');
}

export function isSaveMessage(data: unknown): data is SaveMessage {
  return isFileMessage(data, 'kw-save');
}

export function isSavedMessage(data: unknown): data is SavedMessage {
  if (!hasType(data, 'kw-saved')) return false;
  const rec = data as Record<string, unknown>;
  if (typeof rec.ok !== 'boolean') return false;
  if (rec.error !== undefined && typeof rec.error !== 'string') return false;
  return rec.reason === undefined || rec.reason === 'auth-expired';
}

export function isReconnectMessage(data: unknown): data is ReconnectMessage {
  return hasType(data, 'kw-reconnect');
}

export function isReconnectedMessage(data: unknown): data is ReconnectedMessage {
  if (!hasType(data, 'kw-reconnected')) return false;
  const rec = data as Record<string, unknown>;
  if (typeof rec.ok !== 'boolean') return false;
  return rec.error === undefined || typeof rec.error === 'string';
}

export function isTitleMessage(data: unknown): data is TitleMessage {
  if (!hasType(data, 'kw-title')) return false;
  const rec = data as Record<string, unknown>;
  return typeof rec.filename === 'string' && typeof rec.locked === 'boolean';
}

export function isFindMessage(data: unknown): data is FindMessage {
  return hasType(data, 'kw-find');
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

export function createMessage(): CreateMessage {
  return { type: 'kw-create' };
}

export function saveMessage(filename: string, bytes: ArrayBuffer): SaveMessage {
  return { type: 'kw-save', filename, bytes };
}

export function savedMessage(
  ok: boolean,
  error?: string,
  reason?: SavedFailureReason,
): SavedMessage {
  const message: SavedMessage = { type: 'kw-saved', ok };
  if (error !== undefined) message.error = error;
  if (reason !== undefined) message.reason = reason;
  return message;
}

export function reconnectMessage(): ReconnectMessage {
  return { type: 'kw-reconnect' };
}

export function reconnectedMessage(ok: boolean, error?: string): ReconnectedMessage {
  return error === undefined
    ? { type: 'kw-reconnected', ok }
    : { type: 'kw-reconnected', ok, error };
}

export function titleMessage(filename: string, locked: boolean): TitleMessage {
  return { type: 'kw-title', filename, locked };
}

export function findMessage(): FindMessage {
  return { type: 'kw-find' };
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

// --- Origins ------------------------------------------------------------

/* Each file:// document gets its own opaque origin, so neither side can name
the other; a tuple target is never delivered and arriving messages read "null"
(#83). Widening the target is safe there because nothing crossing it is a secret
the filesystem does not already hold; the master password and the decrypted
entries never leave the implementation. */
export function peerOrigin(protocol: string, origin: string): { target: string; accept: string } {
  return protocol === 'file:'
    ? { target: '*', accept: 'null' }
    : { target: origin, accept: origin };
}
