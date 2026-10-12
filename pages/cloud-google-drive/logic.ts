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

// Build the URL for the fields a version check reads: head revision, its content hash, save time, trashed (#74).
export function buildDriveMetadataUrl(apiBase: string, id: string): string {
  return `${apiBase}/files/${encodeURIComponent(id)}?fields=headRevisionId,sha256Checksum,modifiedTime,trashed`;
}

/** Build the media-update URL that overwrites a file's content in place,
answering with the revision it stored so the next save can build on it (#74). */
export function buildDriveUpdateUrl(uploadBase: string, id: string): string {
  return `${uploadBase}/files/${encodeURIComponent(id)}?uploadType=media&fields=headRevisionId`;
}

// Build the multipart-upload URL that creates a brand-new file, answering with its id and revision.
export function buildDriveCreateUrl(uploadBase: string): string {
  return `${uploadBase}/files?uploadType=multipart&fields=id,headRevisionId`;
}

// A file's stored version as a version check sees it (#74).
export interface DriveRevision {
  version: string;
  sha256?: string;
  savedAt?: string;
  trashed: boolean;
}

// The revision fields of a Drive response, or undefined when it names no head revision.
export function readDriveRevision(body: unknown): DriveRevision | undefined {
  const fields = body as {
    headRevisionId?: unknown;
    sha256Checksum?: unknown;
    modifiedTime?: unknown;
    trashed?: unknown;
  };
  const version = fields?.headRevisionId;
  if (typeof version !== 'string' || version === '') return undefined;
  const revision: DriveRevision = { version, trashed: fields.trashed === true };
  if (typeof fields.sha256Checksum === 'string') revision.sha256 = fields.sha256Checksum;
  if (typeof fields.modifiedTime === 'string') revision.savedAt = fields.modifiedTime;
  return revision;
}

// Lowercase hex SHA-256, the form Drive reports a file's content hash in.
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
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

// How a Drive response should be handled.
export type DriveOutcome = 'ok' | 'auth-expired' | 'retry' | 'fail';

// The reasons Drive gives when a 403 is a throttle rather than a permission failure.
const RETRYABLE_403_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded'];
// Not every expired credential comes back as a 401; these 403s mean the same thing (#85).
const AUTH_403_REASONS = ['authError', 'invalidCredentials'];

/** Drive reports a throttle as a 403 carrying the reason only in its body, so
the body is the one way to tell it from a permanent permission failure (#85). */
export function driveErrorReason(body: unknown): string | undefined {
  const reason = (body as { error?: { errors?: { reason?: unknown }[] } } | null)?.error
    ?.errors?.[0]?.reason;
  return typeof reason === 'string' ? reason : undefined;
}

/** Classify a Drive status. 'auth-expired' stays separate from 'fail' because
renewing the token opens Google's popup, which a blocker stops unless a user
gesture drives it; the UI has to ask rather than the request path retrying on
its own (#85). */
export function classifyDriveResponse(status: number, reason?: string): DriveOutcome {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 401) return 'auth-expired';
  if (status === 429 || status >= 500) return 'retry';
  if (status === 403 && reason !== undefined) {
    if (AUTH_403_REASONS.includes(reason)) return 'auth-expired';
    if (RETRYABLE_403_REASONS.includes(reason)) return 'retry';
  }
  return 'fail';
}

// Counts the first try, so this allows two retries (#85).
export const MAX_DRIVE_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8000;

/** Full jitter over an exponentially growing window, so retries from separate
tabs spread out instead of landing together (#85). */
export function backoffDelayMs(retry: number, random: () => number = Math.random): number {
  return Math.round(random() * Math.min(BASE_RETRY_DELAY_MS * 2 ** retry, MAX_RETRY_DELAY_MS));
}
