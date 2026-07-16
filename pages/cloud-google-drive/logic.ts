/**
 * Pure logic for the Google Drive connector: Drive REST URL construction and
 * postMessage shape guards. None of it touches the DOM, the network, or
 * module-level browser state, so — like router/logic.ts and 0x67/logic.ts — it
 * is unit tested directly under plain Node (see
 * tests/cloud-google-drive-logic.test.ts).
 *
 * Sign-in and file browsing are delegated to Google's own SDKs (GIS token
 * client and the Picker), loaded at runtime by page.ts, so there is no OAuth or
 * file-listing logic here.
 *
 * This is a real ES module. For the browser build, bundle-iife strips the
 * `export` keywords and hoists these names onto globalThis alongside page.ts —
 * this file is one of the concatenated "files" in bundle-iife.json. page.ts
 * consumes them as globals, not via import — see globals.d.ts. (There are no
 * imports here at all: everything is a standard global.)
 */

/** A Drive file, reduced to the fields the connector acts on. The Picker
 * supplies both when the user selects a file. */
export interface DriveFile {
  id: string;
  name: string;
}

/** The message the embedded 0x67 app posts when the user saves. */
export interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}

/**
 * Unwrap a possibly-missing DOM lookup, or fail loudly. page.ts's markup is
 * hand-authored, so a missing element means a real bug, not a state to handle
 * gracefully. Lives here (rather than in page.ts) for the same reason router's
 * does: so its throw branch is exercisable directly from a logic test.
 */
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}

/** Build the media-download URL for a file's bytes. */
export function buildDriveDownloadUrl(apiBase: string, id: string): string {
  return `${apiBase}/files/${encodeURIComponent(id)}?alt=media`;
}

/** Build the media-update URL that overwrites a file's content in place. */
export function buildDriveUpdateUrl(uploadBase: string, id: string): string {
  return `${uploadBase}/files/${encodeURIComponent(id)}?uploadType=media`;
}

/** True if `data` is the embedded app's "I'm ready for a vault" handshake. */
export function isReadyMessage(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).type === 'kw-ready'
  );
}

/** True if `data` is the embedded app's "please persist these bytes" message. */
export function isSaveMessage(data: unknown): data is SaveMessage {
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const rec = data as Record<string, unknown>;
  return (
    rec.type === 'kw-save' && typeof rec.filename === 'string' && rec.bytes instanceof ArrayBuffer
  );
}

/** True if `data` is the embedded app's "safe to remove me now" reply to a
 * `kw-close-request` — either nothing was unsaved, or the user chose to
 * discard it. */
export function isCloseAckMessage(data: unknown): boolean {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).type === 'kw-close-ack'
  );
}
