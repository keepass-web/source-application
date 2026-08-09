/**
 * Ambient declarations for the globals bundle.js injects into the connector
 * page. bundle-iife concatenates packages/router, packages/embed-protocol,
 * this page's pure logic (logic.ts), and page.ts into one IIFE and hoists the
 * names below onto globalThis, one per name in bundle-iife.json's "exports"
 * list — mirroring what tests/cloud-google-drive-page.test.ts sets up by
 * hand.
 *
 * This file exists only so page.ts can be type-checked against that surface; it
 * declares just the members page.ts actually calls, mirroring the signatures in
 * packages/router/src, packages/embed-protocol/src, and logic.ts. The Google SDK
 * globals that page.ts also uses (GIS token client and the Picker, both loaded
 * at runtime from Google) are declared at the bottom.
 */

interface DriveFile {
  id: string;
  name: string;
}

declare function identifyFormat(
  header: Uint8Array,
):
  | { kind: 'invalid' }
  | { kind: 'recognized'; secondaryByte: number; label: string; implementation?: string };

interface ReadyMessage {
  type: 'kw-ready';
}
interface OpenMessage {
  type: 'kw-open';
  filename: string;
  bytes: ArrayBuffer;
}
interface CreateMessage {
  type: 'kw-create';
}
interface SaveMessage {
  type: 'kw-save';
  filename: string;
  bytes: ArrayBuffer;
}
interface SavedMessage {
  type: 'kw-saved';
  ok: boolean;
  error?: string;
}
interface CloseRequestMessage {
  type: 'kw-close-request';
}
interface CloseAckMessage {
  type: 'kw-close-ack';
}
interface CloseMessage {
  type: 'kw-close';
}

declare function must<T>(value: T | null | undefined): T;
declare function buildDriveDownloadUrl(apiBase: string, id: string): string;
declare function buildDriveUpdateUrl(uploadBase: string, id: string): string;
declare function buildDriveCreateUrl(uploadBase: string): string;
declare function buildMultipartBody(
  filename: string,
  bytes: ArrayBuffer,
): { body: Blob; boundary: string };
declare function isReadyMessage(data: unknown): data is ReadyMessage;
declare function isSaveMessage(data: unknown): data is SaveMessage;
declare function isCloseAckMessage(data: unknown): data is CloseAckMessage;
declare function isCloseMessage(data: unknown): data is CloseMessage;
declare function openMessage(filename: string, bytes: ArrayBuffer): OpenMessage;
declare function createMessage(): CreateMessage;
declare function savedMessage(ok: boolean, error?: string): SavedMessage;
declare function closeRequestMessage(): CloseRequestMessage;

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
