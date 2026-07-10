/**
 * Ambient declarations for the globals bundle.js injects into the connector
 * page. bundle-iife concatenates this page's pure logic (logic.ts) and page.ts
 * into one IIFE and hoists logic's exports onto globalThis, one per name in
 * bundle-iife.json's "exports" list — mirroring what
 * tests/cloud-google-drive-page.test.ts sets up by hand.
 *
 * This file exists only so page.ts can be type-checked against that surface; it
 * declares just the members page.ts actually calls, mirroring the signatures in
 * logic.ts. The Google Picker/`gapi` globals that page.ts also uses are
 * declared at the bottom.
 */

interface DriveFile {
  id: string;
  name: string;
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
declare function buildDriveDownloadUrl(apiBase: string, id: string): string;
declare function buildDriveUpdateUrl(uploadBase: string, id: string): string;
declare function parseTokenResponse(json: unknown): { accessToken: string };
declare function isPopupCallback(
  hasOpener: boolean,
  params: { code: string | null; error: string | null },
): boolean;
declare function isOAuthMessage(data: unknown): data is OAuthMessage;
declare function isReadyMessage(data: unknown): boolean;
declare function isSaveMessage(data: unknown): data is SaveMessage;

// --- Google Picker / gapi (loaded at runtime from apis.google.com) ---
// The connector loads Google's own SDK to show the Picker; these are the only
// members page.ts touches. Declared loosely on purpose — this is a foreign,
// remotely-loaded API, not code this project owns or type-checks in depth.

interface GapiLoadable {
  load(name: string, callback: () => void): void;
}

interface PickerDocument {
  [key: string]: unknown;
}

interface PickerResponse {
  [key: string]: unknown;
}

interface PickerInstance {
  setVisible(visible: boolean): void;
}

interface PickerBuilderInstance {
  setOAuthToken(token: string): PickerBuilderInstance;
  setDeveloperKey(key: string): PickerBuilderInstance;
  addView(viewId: string): PickerBuilderInstance;
  setCallback(callback: (data: PickerResponse) => void): PickerBuilderInstance;
  build(): PickerInstance;
}

interface GooglePicker {
  ViewId: { DOCS: string };
  Action: { PICKED: string };
  Response: { ACTION: string; DOCUMENTS: string };
  Document: { ID: string; NAME: string };
  PickerBuilder: new () => PickerBuilderInstance;
}

declare const gapi: GapiLoadable;
declare const google: { picker: GooglePicker };
