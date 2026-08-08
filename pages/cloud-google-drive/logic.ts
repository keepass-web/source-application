/** Pure logic for the Drive connector: URL construction and the must()
guard — no DOM/network state, so unit-tested directly. Sign-in and
browsing live in Google's own SDKs, not here. */

// A Drive file, reduced to the fields the connector needs; the Picker supplies both.
export interface DriveFile {
  id: string;
  name: string;
}

// Unwrap a possibly-missing DOM lookup, or fail loudly; kept here so its throw branch is testable.
export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}

// Build the media-download URL for a file's bytes.
export function buildDriveDownloadUrl(apiBase: string, id: string): string {
  return `${apiBase}/files/${encodeURIComponent(id)}?alt=media`;
}

/** Build the media-update URL that overwrites a file's content in place. */
export function buildDriveUpdateUrl(uploadBase: string, id: string): string {
  return `${uploadBase}/files/${encodeURIComponent(id)}?uploadType=media`;
}
