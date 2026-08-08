/** Opens/saves a database in the user's own Google Drive, without touching
local disk. Never parses or decrypts itself: signs in, picks a file with
the Picker, embeds the real 0x67 app in an iframe, and hands it the
bytes over postMessage (see 0x67/page.ts's "Host integration"). Loads
Google's own SDKs as a scoped no-external-libraries exception — the
0x67 iframe itself still loads nothing external. */

// --- Configuration ---------------------------------------------------------

// OAuth client ID, public by design; GIS requires this origin be authorized on the client.
const CLIENT_ID = '14808408917-6cecfggtk8npdabf40h66h7gh16e7bon.apps.googleusercontent.com';
// Project number (CLIENT_ID's numeric prefix); Picker needs it via setAppId or files.get 404s.
const APP_ID = '14808408917';
/** Picker "developer key" — NOT a secret. Google requires it client-side
and recommends restricting it (HTTP referrer + API scope) instead of
hiding it; this key is so restricted. A secret-scanner flag here is a
known false positive. */
const DEVELOPER_KEY = 'AIzaSyB4TpJlDKYOSY_hrq1DOXkFJRFCaZ_92QA';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';
// drive.file: only files the user picks or creates — non-sensitive, no CASA audit needed.
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

const APP_ORIGIN = window.location.origin;

// --- In-memory state (never persisted) -------------------------------------

let accessToken: string | null = null;
let currentFile: DriveFile | null = null;
let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;
let pickerApiLoaded = false;
let tokenClient: TokenClient | null = null;
// Set while waiting for a kw-close-ack, so handleFrameMessage knows what to run once safe.
let pendingClose: (() => void) | null = null;
// Cached so the GIS script loads at most once, and concurrent callers share it.
let gisReady: Promise<void> | null = null;

// DOM helpers

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
    const bytes = await response.arrayBuffer();
    const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
    const result = identifyFormat(header);

    if (result.kind === 'invalid') {
      setPickStatus(`${file.name} doesn't look like a KDBX file — no recognized signature found.`);
      return;
    }
    if (!result.implementation) {
      setPickStatus(`${file.name} is ${result.label}, which isn't supported yet.`);
      return;
    }
    showHost(file, bytes, result.implementation);
  } catch {
    setPickStatus(`Network error while opening ${file.name}.`);
  }
}

// ============================================================
// Screen: Embedded app (0x67 in an iframe)
// ============================================================

function showHost(file: DriveFile, bytes: ArrayBuffer, implementation: string): void {
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
  qs<HTMLIFrameElement>('#app-frame').src = implementation;
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
    closeRequestMessage(),
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
    source.postMessage(openMessage(open.filename, open.bytes), APP_ORIGIN);
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
      source.postMessage(savedMessage(false, `HTTP ${response.status}`), APP_ORIGIN);
      return;
    }
    source.postMessage(savedMessage(true), APP_ORIGIN);
  } catch {
    source.postMessage(savedMessage(false, 'network error'), APP_ORIGIN);
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
