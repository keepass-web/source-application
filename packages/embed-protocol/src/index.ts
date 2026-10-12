/** `embed-protocol` — the equivalent-origin postMessage contract between a
keepass-web implementation and whatever host embeds it in an iframe.
Centralizes shapes/guards/builders so both ends provably agree on the wire
format: kw-ready, kw-open, kw-create, kw-save, kw-saved, kw-title, kw-find,
kw-close-request, kw-close-ack, kw-close (#1), kw-reconnect, kw-reconnected (#85),
kw-check, kw-checked (#74). */

export interface ReadyMessage {
  type: 'kw-ready';
}

/* Which stored version of the file a database builds on, as an opaque token
only the host reads; the app hands it back so a save never replaces a version
it didn't build on (#74). Absent where the host can't tell versions apart. */
export type Version = string;

export interface OpenMessage {
  type: 'kw-open';
  filename: string;
  bytes: ArrayBuffer;
  version?: Version;
}

// Host tells the app to start a brand-new, empty database instead of opening one.
export interface CreateMessage {
  type: 'kw-create';
}

export interface SaveMessage {
  type: 'kw-save';
  // Saves can overlap, so kw-saved echoes this to name the save it answers (#91).
  id: number;
  filename: string;
  bytes: ArrayBuffer;
  base?: Version; // the version these bytes build on; the host refuses to replace any other
}

/* A failure the app must handle differently from a generic error, rather than
report as a status code: an expired credential is recoverable in place by a
reconnect (#85), and a conflict, a newer version saved elsewhere, by a merge (#74). */
export type SavedFailureReason = 'auth-expired' | 'conflict';

export interface SavedDetails {
  error?: string;
  reason?: SavedFailureReason;
  version?: Version; // what a successful save stored, so the next one builds on it
}

export interface SavedMessage extends SavedDetails {
  type: 'kw-saved';
  id: number;
  ok: boolean;
}

// The app asks whether storage holds a newer version than the one it builds on (#74).
export interface CheckMessage {
  type: 'kw-check';
  base?: Version;
}

/* `unknown` when storage can't be reached or the host can't tell; `gone` when the
file was removed or replaced. A newer version comes with its bytes, so the app
can open or merge it without a second round trip. */
export type CheckStatus = 'unchanged' | 'newer' | 'gone' | 'unknown';

export interface Newer {
  bytes: ArrayBuffer;
  version: Version;
  savedAt?: string; // ISO 8601, for telling the user when
}

export interface CheckedMessage extends Partial<Newer> {
  type: 'kw-checked';
  status: CheckStatus;
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

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
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
  return (
    isFileMessage(data, 'kw-open') && isOptionalString((data as Record<string, unknown>).version)
  );
}

export function isCreateMessage(data: unknown): data is CreateMessage {
  return hasType(data, 'kw-create');
}

export function isSaveMessage(data: unknown): data is SaveMessage {
  if (!isFileMessage(data, 'kw-save')) return false;
  const rec = data as Record<string, unknown>;
  return typeof rec.id === 'number' && isOptionalString(rec.base);
}

export function isSavedMessage(data: unknown): data is SavedMessage {
  if (!hasType(data, 'kw-saved')) return false;
  const rec = data as Record<string, unknown>;
  if (typeof rec.id !== 'number' || typeof rec.ok !== 'boolean') return false;
  if (!isOptionalString(rec.error) || !isOptionalString(rec.version)) return false;
  return rec.reason === undefined || rec.reason === 'auth-expired' || rec.reason === 'conflict';
}

export function isCheckMessage(data: unknown): data is CheckMessage {
  return hasType(data, 'kw-check') && isOptionalString((data as Record<string, unknown>).base);
}

export function isCheckedMessage(data: unknown): data is CheckedMessage {
  if (!hasType(data, 'kw-checked')) return false;
  const rec = data as Record<string, unknown>;
  if (rec.status === 'newer') {
    return (
      rec.bytes instanceof ArrayBuffer &&
      typeof rec.version === 'string' &&
      rec.version !== '' &&
      isOptionalString(rec.savedAt)
    );
  }
  return rec.status === 'unchanged' || rec.status === 'gone' || rec.status === 'unknown';
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

export function openMessage(filename: string, bytes: ArrayBuffer, version?: Version): OpenMessage {
  return version === undefined
    ? { type: 'kw-open', filename, bytes }
    : { type: 'kw-open', filename, bytes, version };
}

export function createMessage(): CreateMessage {
  return { type: 'kw-create' };
}

export function saveMessage(
  id: number,
  filename: string,
  bytes: ArrayBuffer,
  base?: Version,
): SaveMessage {
  return base === undefined
    ? { type: 'kw-save', id, filename, bytes }
    : { type: 'kw-save', id, filename, bytes, base };
}

export function savedMessage(id: number, ok: boolean, details: SavedDetails = {}): SavedMessage {
  const message: SavedMessage = { type: 'kw-saved', id, ok };
  if (details.error !== undefined) message.error = details.error;
  if (details.reason !== undefined) message.reason = details.reason;
  if (details.version !== undefined) message.version = details.version;
  return message;
}

export function checkMessage(base?: Version): CheckMessage {
  return base === undefined ? { type: 'kw-check' } : { type: 'kw-check', base };
}

export function checkedMessage(status: Exclude<CheckStatus, 'newer'>): CheckedMessage;
export function checkedMessage(status: 'newer', newer: Newer): CheckedMessage;
export function checkedMessage(status: CheckStatus, newer?: Newer): CheckedMessage {
  return { type: 'kw-checked', status, ...newer };
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
