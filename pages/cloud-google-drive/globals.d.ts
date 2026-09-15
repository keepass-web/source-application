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
  reason?: 'auth-expired';
}
interface ReconnectMessage {
  type: 'kw-reconnect';
}
interface ReconnectedMessage {
  type: 'kw-reconnected';
  ok: boolean;
  error?: string;
}
interface TitleMessage {
  type: 'kw-title';
  filename: string;
  locked: boolean;
}
interface CloseRequestMessage {
  type: 'kw-close-request';
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
type DriveOutcome = 'ok' | 'auth-expired' | 'retry' | 'fail';
declare function driveErrorReason(body: unknown): string | undefined;
declare function classifyDriveResponse(status: number, reason?: string): DriveOutcome;
declare const MAX_DRIVE_ATTEMPTS: number;
declare function backoffDelayMs(retry: number, random?: () => number): number;
declare function isReadyMessage(data: unknown): data is ReadyMessage;
declare function isSaveMessage(data: unknown): data is SaveMessage;
declare function isTitleMessage(data: unknown): data is TitleMessage;
declare function isCloseMessage(data: unknown): data is CloseMessage;
declare function isReconnectMessage(data: unknown): data is ReconnectMessage;
declare function openMessage(filename: string, bytes: ArrayBuffer): OpenMessage;
declare function createMessage(): CreateMessage;
declare function savedMessage(ok: boolean, error?: string, reason?: 'auth-expired'): SavedMessage;
declare function reconnectedMessage(ok: boolean, error?: string): ReconnectedMessage;
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

declare function applyTabState(
  doc: Document,
  baseTitle: string,
  filename: string,
  locked: boolean,
): void;

declare const gapi: GapiLoadable;
declare const google: {
  picker: GooglePicker;
  accounts: { oauth2: GoogleOAuth2 };
};

interface FindMessage {
  type: 'kw-find';
}
declare function findMessage(): FindMessage;

declare function peerOrigin(protocol: string, origin: string): { target: string; accept: string };
