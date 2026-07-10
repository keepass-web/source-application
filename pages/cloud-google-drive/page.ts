// ============================================================
// Google Drive connector
// ============================================================
//
// Opens and saves a KeePass database that lives in the user's own Google
// Drive, without the bytes ever touching local disk. The connector itself
// never parses or decrypts anything: it authenticates to Drive, lets the user
// pick a `.kdbx` file, then embeds the real 0x67 app in an iframe and hands it
// the bytes over a small same-origin postMessage protocol (see 0x67/page.ts's
// "Host integration" section). Editing, unlocking, and saving are all the
// unmodified 0x67 app; this page only fetches and writes back the file.
//
// Auth is OAuth 2.0 with PKCE (a public client — no secret). Sign-in runs in a
// popup so the code_verifier stays in this window's live memory across the
// redirect: nothing is written to localStorage, sessionStorage, or a cookie,
// consistent with the project's no-persistence rule. The access token, too,
// lives only in the variables below and is gone when the tab closes.
//
// (must, and the build*/parse*/is* helpers, are declared in globals.d.ts and
//  supplied at runtime by logic.ts — bundle-iife concatenates the two. See
//  globals.d.ts.)

// --- Configuration ---------------------------------------------------------

// The OAuth client ID for the "Web application" client registered to
// keepass-web.app. It is public by design (PKCE, no secret) and must list this
// page's URL as an authorized redirect URI. Replace with the project's own
// client ID before deploying; see docs/PAGES.md.
const CLIENT_ID = 'REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
// Full Drive scope: needed to browse the user's existing databases (files.list
// over files this app didn't create) and to write edits back to them in place.
const SCOPE = 'https://www.googleapis.com/auth/drive';

const APP_ORIGIN = window.location.origin;
const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

// --- In-memory state (never persisted) -------------------------------------

let accessToken: string | null = null;
let pkce: { verifier: string; state: string } | null = null;
let currentFile: DriveFile | null = null;
let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;

// ============================================================
// DOM helpers
// ============================================================

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return must(document.getElementById(id) as T | null);
}

function cloneTemplate(id: string): DocumentFragment {
  return byId<HTMLTemplateElement>(id).content.cloneNode(true) as DocumentFragment;
}

function setRoot(fragment: DocumentFragment): void {
  const root = byId('root');
  root.innerHTML = '';
  root.appendChild(fragment);
}

function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  return must(byId('root').querySelector<T>(selector));
}

function authHeader(): Record<string, string> {
  return { Authorization: `Bearer ${must(accessToken)}` };
}

/** Replace a container's content with a single status line. */
function renderMessage(container: HTMLElement, text: string): void {
  container.innerHTML = '';
  const p = document.createElement('p');
  p.className = 'drive-message';
  p.textContent = text;
  container.appendChild(p);
}

// ============================================================
// Screen: Sign in
// ============================================================

function showSignIn(): void {
  setRoot(cloneTemplate('tpl-signin'));
  qs('[data-action="signin"]').addEventListener('click', () => {
    void startAuth();
  });
}

function showSignInError(message: string): void {
  const error = qs('#signin-error');
  error.textContent = message;
  error.hidden = false;
}

async function startAuth(): Promise<void> {
  const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  pkce = { verifier, state };
  const codeChallenge = await sha256Base64Url(verifier);
  window.addEventListener('message', handleOAuthMessage);
  const url = buildAuthUrl({
    authEndpoint: AUTH_ENDPOINT,
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    scope: SCOPE,
    state,
    codeChallenge,
  });
  window.open(url, 'kw-google-oauth', 'width=480,height=640');
}

async function handleOAuthMessage(event: MessageEvent): Promise<void> {
  if (event.origin !== APP_ORIGIN || !isOAuthMessage(event.data)) return;
  window.removeEventListener('message', handleOAuthMessage);

  const { code, state, error } = event.data;
  const session = must(pkce);
  if (state !== session.state) {
    showSignInError('Sign-in could not be verified. Please try again.');
    return;
  }
  if (error !== null || code === null) {
    showSignInError('Google sign-in was cancelled or denied.');
    return;
  }
  try {
    accessToken = await exchangeCode(code, session.verifier);
    pkce = null;
    void showBrowser('');
  } catch (err) {
    showSignInError(err instanceof Error ? err.message : 'Sign-in failed.');
  }
}

async function exchangeCode(code: string, verifier: string): Promise<string> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildTokenRequestBody({
      clientId: CLIENT_ID,
      code,
      redirectUri: REDIRECT_URI,
      codeVerifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`Token exchange failed (HTTP ${response.status}).`);
  }
  return parseTokenResponse(await response.json()).accessToken;
}

// ============================================================
// Screen: Drive browser
// ============================================================

async function showBrowser(search: string): Promise<void> {
  setRoot(cloneTemplate('tpl-browser'));
  const searchInput = qs<HTMLInputElement>('#drive-search');
  searchInput.value = search;
  searchInput.addEventListener('input', () => {
    void loadFiles(searchInput.value);
  });
  qs('[data-action="signout"]').addEventListener('click', signOut);
  await loadFiles(search);
}

async function loadFiles(search: string): Promise<void> {
  const listEl = qs('#drive-files');
  renderMessage(listEl, 'Loading…');
  try {
    const response = await fetch(buildDriveListUrl(DRIVE_API, search), { headers: authHeader() });
    if (!response.ok) {
      renderMessage(listEl, `Couldn't list files (HTTP ${response.status}).`);
      return;
    }
    renderFileList(listEl, parseDriveFileList(await response.json()));
  } catch {
    renderMessage(listEl, 'Network error while listing files.');
  }
}

function renderFileList(container: HTMLElement, files: DriveFile[]): void {
  if (files.length === 0) {
    renderMessage(container, 'No .kdbx files found.');
    return;
  }
  container.innerHTML = '';
  for (const file of files) {
    container.appendChild(buildFileRow(file));
  }
}

function buildFileRow(file: DriveFile): HTMLButtonElement {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'drive-file';

  const name = document.createElement('span');
  name.className = 'drive-file-name';
  name.textContent = file.name;
  row.appendChild(name);

  const meta = describeFile(file);
  if (meta !== '') {
    const sub = document.createElement('span');
    sub.className = 'drive-file-meta';
    sub.textContent = meta;
    row.appendChild(sub);
  }

  row.addEventListener('click', () => {
    void openFile(file);
  });
  return row;
}

async function openFile(file: DriveFile): Promise<void> {
  const listEl = qs('#drive-files');
  renderMessage(listEl, `Opening ${file.name}…`);
  try {
    const response = await fetch(buildDriveDownloadUrl(DRIVE_API, file.id), {
      headers: authHeader(),
    });
    if (!response.ok) {
      renderMessage(listEl, `Couldn't open ${file.name} (HTTP ${response.status}).`);
      return;
    }
    showHost(file, await response.arrayBuffer());
  } catch {
    renderMessage(listEl, `Network error while opening ${file.name}.`);
  }
}

// ============================================================
// Screen: Embedded app (0x67 in an iframe)
// ============================================================

function showHost(file: DriveFile, bytes: ArrayBuffer): void {
  currentFile = file;
  pendingOpen = { filename: file.name, bytes };
  setRoot(cloneTemplate('tpl-host'));
  qs('#host-filename').textContent = file.name;
  qs('[data-action="back-to-drive"]').addEventListener('click', () => {
    window.removeEventListener('message', handleFrameMessage);
    currentFile = null;
    pendingOpen = null;
    void showBrowser('');
  });
  window.addEventListener('message', handleFrameMessage);
  // Setting src last means the iframe's script (and its kw-ready handshake)
  // can't fire before the listener above is attached.
  qs<HTMLIFrameElement>('#app-frame').src = '0x67.html';
}

function handleFrameMessage(event: MessageEvent): void {
  if (event.origin !== APP_ORIGIN) return;
  const iframe = document.getElementById('app-frame') as HTMLIFrameElement | null;
  if (iframe === null || event.source === null || event.source !== iframe.contentWindow) return;

  const source = event.source as Window;
  if (isReadyMessage(event.data)) {
    const open = must(pendingOpen);
    source.postMessage({ type: 'kw-open', filename: open.filename, bytes: open.bytes }, APP_ORIGIN);
  } else if (isSaveMessage(event.data)) {
    void saveToDrive(event.data.bytes, source);
  }
}

async function saveToDrive(bytes: ArrayBuffer, source: Window): Promise<void> {
  const file = must(currentFile);
  try {
    const response = await fetch(buildDriveUpdateUrl(UPLOAD_API, file.id), {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    if (!response.ok) {
      source.postMessage(
        { type: 'kw-saved', ok: false, error: `HTTP ${response.status}` },
        APP_ORIGIN,
      );
      return;
    }
    source.postMessage({ type: 'kw-saved', ok: true }, APP_ORIGIN);
  } catch {
    source.postMessage({ type: 'kw-saved', ok: false, error: 'network error' }, APP_ORIGIN);
  }
}

function signOut(): void {
  accessToken = null;
  currentFile = null;
  pendingOpen = null;
  showSignIn();
}

// ============================================================
// Boot
// ============================================================

// Two roles for this one page. Loaded as the OAuth popup (Google redirected it
// back here with a code/error and it has an opener), it forwards the result to
// the opener and closes. Loaded normally, it runs the connector UI.
const callback = parseCallbackParams(window.location.search);
if (isPopupCallback(window.opener !== null, callback)) {
  const opener = must(window.opener);
  opener.postMessage(
    { type: 'kw-oauth', code: callback.code, state: callback.state, error: callback.error },
    APP_ORIGIN,
  );
  window.close();
} else {
  showSignIn();
}
