/** Pure logic for the Drive connector: URL/request-body construction and the
must() guard — no DOM/network state, so unit-tested directly. Sign-in and
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

// Build the multipart-upload URL that creates a brand-new file.
export function buildDriveCreateUrl(uploadBase: string): string {
  return `${uploadBase}/files?uploadType=multipart`;
}

/** Build a multipart/related body for that create call: a JSON metadata part
naming the file (root of My Drive — drive.file grants no folder browsing to
place it elsewhere), then the raw bytes. Returns the boundary alongside the
body since the caller needs it for the Content-Type header. */
export function buildMultipartBody(
  filename: string,
  bytes: ArrayBuffer,
): { body: Blob; boundary: string } {
  const boundary = crypto.randomUUID();
  const metadata = JSON.stringify({ name: filename });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  return { body, boundary };
}
