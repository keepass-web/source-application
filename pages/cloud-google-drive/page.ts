// ============================================================
// Google Drive connector
// ============================================================
//
// Opens and saves a KeePass database that lives in the user's own Google
// Drive, without the bytes ever touching local disk. The connector itself
// never parses or decrypts anything: it authenticates to Drive, lets the user
// pick a file with the Google Picker, downloads its bytes, then embeds the
// real 0x67 app in an iframe and hands it those bytes over a small same-origin
// postMessage protocol (see 0x67/page.ts's "Host integration" section). All
// unlocking, browsing, and editing is the unmodified 0x67 app.
//
// File selection uses the Google Picker, which requires loading Google's own
// SDK (apis.google.com/js/api.js) at runtime. That is a deliberate, scoped
// exception to the project's "no external libraries" rule: it holds absolutely
// for 0x67 and every offline page, but a cloud connector is inherently online
// and is loading the SAME provider the user just chose to sign in to — not an
// unrelated third party. Crucially, the master password and all decryption
// stay inside the 0x67 iframe, which loads no external code; Google's SDK,
// here in the outer connector, only ever sees OAuth and encrypted `.kdbx`
// bytes. Using the Picker also lets the connector request the non-sensitive
// `drive.file` scope, which needs no restricted-scope security audit.
//
// Auth is OAuth 2.0 with PKCE (a public client — no secret). Sign-in runs in a
// popup so the code_verifier stays in this window's live memory across the
// redirect: nothing is written to localStorage, sessionStorage, or a cookie.
// The access token likewise lives only in the variables below.
//
// (must, and the build*/parse*/is* helpers, are declared in globals.d.ts and
//  supplied at runtime by logic.ts — bundle-iife concatenates the two. The
//  gapi/google.picker globals are declared there too. See globals.d.ts.)

// --- Configuration ---------------------------------------------------------

// OAuth client ID for the "Web application" client registered to
// keepass-web.app; public by design (PKCE, no secret). Its authorized redirect
// URI must be this page's own URL.
const CLIENT_ID = '14808408917-6cecfggtk8npdabf40h66h7gh16e7bon.apps.googleusercontent.com';
// API key ("developer key") for the same Google Cloud project, used by the
// Picker. This is NOT a secret: the Picker requires the key in client-side JS,
// so it is exposed by design and can't be hidden (unlike an OAuth client
// secret). Google's guidance is to secure such keys by restriction, not
// concealment — this key is locked to this project's HTTP referrers and
// restricted to the Picker API only, and the project has no billable/abusable
// API (e.g. Generative Language) enabled. A secret-scanner that flags the
// literal below (e.g. CodeQL) is a known false positive; dismiss it with a
// reference to this note. See:
//   https://firebase.google.com/docs/projects/api-keys ("do not generally
//     need to be treated as secret ... take extra precautions with API keys
//     used with other Google Cloud APIs")
//   https://docs.cloud.google.com/api-keys/docs/add-restrictions-api-keys
const DEVELOPER_KEY = 'AIzaSyB4TpJlDKYOSY_hrq1DOXkFJRFCaZ_92QA';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
// drive.file: per-file access limited to the databases the user selects in the
// Picker (and files this app creates). A non-sensitive scope — no restricted-
// scope CASA audit — which is what keeps the connector shippable today.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const APP_ORIGIN = window.location.origin;
const REDIRECT_URI = `${window.location.origin}${window.location.pathname}`;

// --- In-memory state (never persisted) -------------------------------------

let accessToken: string | null = null;
let pkce: { verifier: string; state: string } | null = null;
let currentFile: DriveFile | null = null;
let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;
let pickerApiLoaded = false;

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
    showChooser();
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
// Screen: Choose a file (Google Picker)
// ============================================================

function showChooser(): void {
  setRoot(cloneTemplate('tpl-picker'));
  qs('[data-action="pick"]').addEventListener('click', () => {
    void chooseFile();
  });
  qs('[data-action="signout"]').addEventListener('click', signOut);
}

function setPickStatus(text: string): void {
  const status = qs('#pick-status');
  status.textContent = text;
  status.hidden = false;
}

async function chooseFile(): Promise<void> {
  try {
    await ensurePicker();
  } catch {
    setPickStatus('Could not load the Google Picker. Check your connection and try again.');
    return;
  }
  openPicker();
}

/** Load Google's API script, then its Picker module. Idempotent. */
async function ensurePicker(): Promise<void> {
  if (pickerApiLoaded) return;
  await loadScript(GAPI_SRC);
  await new Promise<void>((resolve) => {
    gapi.load('picker', () => resolve());
  });
  pickerApiLoaded = true;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

function openPicker(): void {
  const picker = new google.picker.PickerBuilder()
    .setOAuthToken(must(accessToken))
    .setDeveloperKey(DEVELOPER_KEY)
    .addView(google.picker.ViewId.DOCS)
    .setCallback(handlePickerResult)
    .build();
  picker.setVisible(true);
}

function handlePickerResult(data: PickerResponse): void {
  if (data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) return;
  const docs = data[google.picker.Response.DOCUMENTS] as PickerDocument[];
  const doc = must(docs[0]);
  const file: DriveFile = {
    id: String(doc[google.picker.Document.ID]),
    name: String(doc[google.picker.Document.NAME]),
  };
  void openPickedFile(file);
}

async function openPickedFile(file: DriveFile): Promise<void> {
  setPickStatus(`Opening ${file.name}…`);
  try {
    const response = await fetch(buildDriveDownloadUrl(DRIVE_API, file.id), {
      headers: authHeader(),
    });
    if (!response.ok) {
      setPickStatus(`Could not open ${file.name} (HTTP ${response.status}).`);
      return;
    }
    showHost(file, await response.arrayBuffer());
  } catch {
    setPickStatus(`Network error while opening ${file.name}.`);
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
    showChooser();
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
