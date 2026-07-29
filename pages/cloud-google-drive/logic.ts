/**
 * Pure logic for the Google Drive connector: Drive REST URL construction and
 * the must()-style "fail loudly on a missing DOM node" guard page.ts needs.
 * None of it touches the DOM, the network, or module-level browser state, so
 * — like local's and 0x67's logic.ts — it is unit tested directly under
 * plain Node (see tests/cloud-google-drive-logic.test.ts).
 *
 * Sign-in and file browsing are delegated to Google's own SDKs (GIS token
 * client and the Picker), loaded at runtime by page.ts, so there is no OAuth or
 * file-listing logic here. Format detection (packages/router) and the
 * embedded-app message protocol (packages/embed-protocol) are shared with
 * every other chooser page rather than duplicated here.
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

/**
 * Unwrap a possibly-missing DOM lookup, or fail loudly. page.ts's markup is
 * hand-authored, so a missing element means a real bug, not a state to handle
 * gracefully. Lives here (rather than in page.ts) for the same reason local's
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
