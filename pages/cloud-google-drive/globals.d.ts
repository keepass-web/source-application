/**
 * Ambient declarations for the globals bundle.js injects into the connector
 * page. bundle-iife concatenates this page's pure logic (logic.ts) and page.ts
 * into one IIFE and hoists logic's exports onto globalThis, one per name in
 * bundle-iife.json's "exports" list — mirroring what
 * tests/cloud-google-drive-page.test.ts sets up by hand.
 *
 * This file exists only so page.ts can be type-checked against that surface; it
 * declares just the members page.ts actually calls, mirroring the signatures in
 * logic.ts.
 */

interface DriveFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface OAuthMessage {
  type: 'kw-oauth';
  code: string | null;
  state: string | null;
  error: string | null;
}

interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}

declare function must<T>(value: T | null | undefined): T;
declare function base64UrlEncode(bytes: Uint8Array): string;
declare function sha256Base64Url(input: string): Promise<string>;
declare function parseCallbackParams(search: string): {
  code: string | null;
  state: string | null;
  error: string | null;
};
declare function buildAuthUrl(config: {
  authEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}): string;
declare function buildTokenRequestBody(config: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string;
declare function buildDriveListUrl(apiBase: string, search: string): string;
declare function buildDriveDownloadUrl(apiBase: string, id: string): string;
declare function buildDriveUpdateUrl(uploadBase: string, id: string): string;
declare function parseTokenResponse(json: unknown): { accessToken: string };
declare function parseDriveFileList(json: unknown): DriveFile[];
declare function describeFile(file: DriveFile): string;
declare function isPopupCallback(
  hasOpener: boolean,
  params: { code: string | null; error: string | null },
): boolean;
declare function isOAuthMessage(data: unknown): data is OAuthMessage;
declare function isReadyMessage(data: unknown): boolean;
declare function isSaveMessage(data: unknown): data is SaveMessage;
