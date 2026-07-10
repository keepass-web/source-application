/**
 * Pure logic for the Google Drive connector: PKCE/OAuth string building, Drive
 * REST URL construction, token parsing, and postMessage shape guards. None of
 * it touches the DOM, the network, or module-level browser state, so — like
 * router/logic.ts and 0x67/logic.ts — it is unit tested directly under plain
 * Node (see tests/cloud-google-drive-logic.test.ts).
 *
 * It uses only web-standard globals that Node also provides (crypto, btoa,
 * TextEncoder, URL/URLSearchParams), never any Node-only or DOM-only API, so
 * the same code runs unchanged in the browser bundle and in tests. File
 * browsing itself is delegated to the Google Picker (Google's own SDK, loaded
 * at runtime by page.ts), so there is no file-listing logic here.
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

/** The message a popup posts back to its opener after the OAuth redirect. */
export interface OAuthMessage {
  type: 'kw-oauth';
  code: string | null;
  state: string | null;
  error: string | null;
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

/** URL-safe base64 (RFC 4648 §5) with padding stripped — the encoding PKCE
 * verifiers, challenges, and state tokens all use. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The PKCE code challenge for a verifier: base64url(SHA-256(verifier)). */
export async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Read the OAuth redirect parameters out of a `location.search` string. */
export function parseCallbackParams(search: string): {
  code: string | null;
  state: string | null;
  error: string | null;
} {
  const params = new URLSearchParams(search);
  return {
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
  };
}

/** Build the authorization-endpoint URL for the PKCE authorization-code flow. */
export function buildAuthUrl(config: {
  authEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scope,
    state: config.state,
    code_challenge: config.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent',
  });
  return `${config.authEndpoint}?${params.toString()}`;
}

/** Build the form body for the token exchange. No client secret: this is a
 * public client, and PKCE is what proves the request came from the same party
 * that started the flow. */
export function buildTokenRequestBody(config: {
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): string {
  return new URLSearchParams({
    client_id: config.clientId,
    code: config.code,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: config.codeVerifier,
  }).toString();
}

/** Build the media-download URL for a file's bytes. */
export function buildDriveDownloadUrl(apiBase: string, id: string): string {
  return `${apiBase}/files/${encodeURIComponent(id)}?alt=media`;
}

/** Build the media-update URL that overwrites a file's content in place. */
export function buildDriveUpdateUrl(uploadBase: string, id: string): string {
  return `${uploadBase}/files/${encodeURIComponent(id)}?uploadType=media`;
}

/** Extract the access token from a token-endpoint response, or throw. */
export function parseTokenResponse(json: unknown): { accessToken: string } {
  if (json !== null && typeof json === 'object') {
    const token = (json as Record<string, unknown>).access_token;
    if (typeof token === 'string') {
      return { accessToken: token };
    }
  }
  throw new Error('The token response contained no access token.');
}

/** Whether this page load is an OAuth popup delivering a result back to its
 * opener (Google redirected it here with a code or error, and it has an
 * opener), as opposed to a normal visit to the connector. */
export function isPopupCallback(
  hasOpener: boolean,
  params: { code: string | null; error: string | null },
): boolean {
  return hasOpener && (params.code !== null || params.error !== null);
}

/** True if `data` is the OAuth result a popup posts back to its opener. */
export function isOAuthMessage(data: unknown): data is OAuthMessage {
  return (
    data !== null &&
    typeof data === 'object' &&
    (data as Record<string, unknown>).type === 'kw-oauth'
  );
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
