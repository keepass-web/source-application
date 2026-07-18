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
// This connector loads two of Google's own SDKs at runtime — Google Identity
// Services (accounts.google.com/gsi/client) for sign-in and the Picker
// (apis.google.com/js/api.js) for file selection. That is a deliberate, scoped
// exception to the project's "no external libraries" rule: it holds absolutely
// for 0x67 and every offline page, but a cloud connector is inherently online
// and is loading the SAME provider the user just chose to sign in to — not an
// unrelated third party. The master password and all decryption stay inside the
// 0x67 iframe, which loads no external code; Google's SDKs here in the outer
// connector only ever see OAuth and encrypted `.kdbx` bytes.
//
// Sign-in uses the GIS token model (`initTokenClient`), which returns a
// short-lived access token straight to this page via a Google-run popup — no
// client secret, no authorization-code exchange, and (unlike a redirect flow)
// nothing to persist across a navigation: no localStorage, sessionStorage, or
// cookie. The access token lives only in the variable below. The cost of the
// token model is that it is popup-only; on a browser that blocks the popup
// (e.g. a locked-down kiosk) the user must allow popups for this site. That
// trade-off is deliberate: a redirect flow would require storing a CSRF `state`
// nonce across the navigation, which the no-persistence rule forbids.
//
// (must, and the build*/is* helpers, are declared in globals.d.ts and supplied
//  at runtime by logic.ts — bundle-iife concatenates the two. The gapi/google
//  SDK globals are declared there too. See globals.d.ts.)

// --- Configuration ---------------------------------------------------------

// OAuth client ID for the "Web application" client registered to
// keepass-web.app; public by design. GIS requires this page's origin to be an
// authorized JavaScript origin on the client (no redirect URI is used).
const CLIENT_ID = '14808408917-6cecfggtk8npdabf40h66h7gh16e7bon.apps.googleusercontent.com';
// Google Cloud project number (the numeric prefix of CLIENT_ID). The Picker
// needs it via setAppId so that a file the user selects is granted to this app
// under the drive.file scope; without it, the later files.get returns 404.
const APP_ID = '14808408917';
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
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
// drive.file: per-file access limited to the databases the user selects in the
// Picker (and files this app creates). A non-sensitive scope — no restricted-
// scope CASA audit — which is what keeps the connector shippable today.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const APP_ORIGIN = window.location.origin;

// --- In-memory state (never persisted) -------------------------------------

let accessToken: string | null = null;
let currentFile: DriveFile | null = null;
let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;
let pickerApiLoaded = false;
let tokenClient: TokenClient | null = null;
// Set while waiting for the embedded app to ack a kw-close-request, so
// handleFrameMessage knows what to run once it's safe to tear the iframe down.
let pendingClose: (() => void) | null = null;
// Cached so the GIS script loads at most once, and concurrent callers share it.
let gisReady: Promise<void> | null = null;

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

// ============================================================
// Screen: Sign in (GIS token model)
// ============================================================

function showSignIn(): void {
  setRoot(cloneTemplate('tpl-signin'));
  qs('[data-action="signin"]').addEventListener('click', () => {
    void onSignIn();
  });
}

function showSignInError(message: string): void {
  const error = qs('#signin-error');
  error.textContent = message;
  error.hidden = false;
}

/** Load GIS (once) and initialise the token client, wiring the token and error
 * callbacks. */
function ensureGis(): Promise<void> {
  if (gisReady === null) {
    gisReady = loadScript(GIS_SRC).then(() => {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: handleTokenResponse,
        error_callback: handleTokenError,
      });
    });
  }
  return gisReady;
}

async function onSignIn(): Promise<void> {
  try {
    await ensureGis();
  } catch {
    gisReady = null; // let a retry re-load the script
    showSignInError('Could not load Google sign-in. Check your connection and try again.');
    return;
  }
  // Opens Google's own sign-in popup; the result arrives at the callbacks below.
  must(tokenClient).requestAccessToken();
}

function handleTokenResponse(response: TokenResponse): void {
  if (typeof response.access_token === 'string' && response.access_token !== '') {
    accessToken = response.access_token;
    showChooser();
    return;
  }
  showSignInError('Google sign-in did not complete. Please try again.');
}

function handleTokenError(error: TokenErrorResponse): void {
  showSignInError(
    error.type === 'popup_failed_to_open'
      ? 'The sign-in popup was blocked. Allow popups for this site, then try again.'
      : 'Google sign-in was cancelled.',
  );
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

function openPicker(): void {
  const picker = new google.picker.PickerBuilder()
    .setAppId(APP_ID)
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
    requestCloseIframe(tearDownIframe);
  });
  window.addEventListener('message', handleFrameMessage);
  // Setting src last means the iframe's script (and its kw-ready handshake)
  // can't fire before the listener above is attached.
  qs<HTMLIFrameElement>('#app-frame').src = '0x67.html';
}

function tearDownIframe(): void {
  window.removeEventListener('message', handleFrameMessage);
  currentFile = null;
  pendingOpen = null;
  showChooser();
}

/** Ask the embedded app whether it's safe to remove the iframe — it may have
 * unsaved edits, in which case it shows its own discard-confirmation dialog
 * and only acks if the user agrees. `afterClose` runs once that ack arrives
 * (see handleFrameMessage's isCloseAckMessage branch); if the user cancels,
 * no ack ever comes and nothing happens, exactly like cancelling the same
 * dialog standalone. */
function requestCloseIframe(afterClose: () => void): void {
  pendingClose = afterClose;
  must(qs<HTMLIFrameElement>('#app-frame').contentWindow).postMessage(
    { type: 'kw-close-request' },
    APP_ORIGIN,
  );
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
  } else if (isCloseAckMessage(event.data)) {
    const afterClose = pendingClose;
    pendingClose = null;
    afterClose?.();
  } else if (isCloseMessage(event.data)) {
    // App-initiated (its own ✕ button) — no request/ack round-trip needed.
    tearDownIframe();
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

showSignIn();
