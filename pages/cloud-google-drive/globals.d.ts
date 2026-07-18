/**
 * Ambient declarations for the globals bundle.js injects into the connector
 * page. bundle-iife concatenates this page's pure logic (logic.ts) and page.ts
 * into one IIFE and hoists logic's exports onto globalThis, one per name in
 * bundle-iife.json's "exports" list — mirroring what
 * tests/cloud-google-drive-page.test.ts sets up by hand.
 *
 * This file exists only so page.ts can be type-checked against that surface; it
 * declares just the members page.ts actually calls, mirroring the signatures in
 * logic.ts. The Google SDK globals that page.ts also uses (GIS token client and
 * the Picker, both loaded at runtime from Google) are declared at the bottom.
 */

interface DriveFile {
  id: string;
  name: string;
}

interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}

declare function must<T>(value: T | null | undefined): T;
declare function buildDriveDownloadUrl(apiBase: string, id: string): string;
declare function buildDriveUpdateUrl(uploadBase: string, id: string): string;
declare function isReadyMessage(data: unknown): boolean;
declare function isSaveMessage(data: unknown): data is SaveMessage;
declare function isCloseAckMessage(data: unknown): boolean;
declare function isCloseMessage(data: unknown): boolean;

// --- Google SDKs (loaded at runtime from Google) ---
// Declared loosely on purpose — these are foreign, remotely-loaded APIs, not
// code this project owns or type-checks in depth. Only the members page.ts
// touches are declared.

// Google Identity Services token model.
interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface TokenErrorResponse {
  type?: string;
  message?: string;
}

interface TokenClient {
  requestAccessToken(): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback: (error: TokenErrorResponse) => void;
  }): TokenClient;
}

// Google Picker.
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
  setAppId(appId: string): PickerBuilderInstance;
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
declare const google: {
  picker: GooglePicker;
  accounts: { oauth2: GoogleOAuth2 };
};
