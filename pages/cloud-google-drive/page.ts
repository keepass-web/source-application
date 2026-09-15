/** Opens/creates/saves a database in the user's own Google Drive, without
touching local disk. Never parses or decrypts itself: signs in, then either
picks a file with the Picker or starts a create, embeds the real 0x67 app in
an iframe, and hands it the bytes (or a create instruction) over postMessage
(see 0x67/page.ts's "Host integration"). Loads Google's own SDKs as a
scoped no-external-libraries exception — the 0x67 iframe itself still loads
nothing external. */

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

const PEER = peerOrigin(window.location.protocol, window.location.origin);
// The only current KDBX implementation. Opening detects this from a file's
// bytes via packages/router; creating has no bytes to sniff, so it's named directly.
const APP_IMPLEMENTATION = '0x67.html';
// This page's own title, kept so closing the app can hand the tab back (#65).
const BASE_TITLE = document.title;

// --- In-memory state (never persisted) -------------------------------------

let accessToken: string | null = null;
// The Drive file a save writes back to — null until create's first save
// makes one, or open picks an existing one.
let currentFile: DriveFile | null = null;
type PendingAction = { kind: 'open'; filename: string; bytes: ArrayBuffer } | { kind: 'create' };
let pendingAction: PendingAction | null = null;
let pickerApiLoaded = false;
let tokenClient: TokenClient | null = null;
/* Whether the embedded app has announced itself with kw-ready. A frame that
never did cannot answer a close request, and holds nothing the user reached
through this page, so it is removed without asking (#83). */
let appReady = false;
// Cached so the GIS script loads at most once, and concurrent callers share it.
let gisReady: Promise<void> | null = null;
/* One in-flight token request shared by every caller, so a sign-in and a
reconnect can never open two consent popups at once (#85). */
let tokenRequest: Promise<string> | null = null;
let settleToken: { resolve: (token: string) => void; reject: (error: Error) => void } | null = null;

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

// --- Drive requests --------------------------------------------------------

interface DriveRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit;
}

type DriveResult =
  | { outcome: 'ok'; response: Response }
  | { outcome: 'auth-expired' | 'unreachable' | 'fail'; error: string };

type DriveFailure = Exclude<DriveResult, { outcome: 'ok' }>['outcome'];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

// Only a 403 carries a reason worth reading, and no other failing body is used (#85).
async function throttleReason(response: Response): Promise<string | undefined> {
  if (response.status !== 403) return undefined;
  try {
    return driveErrorReason(await response.json());
  } catch {
    return undefined;
  }
}

/** Issue an authorized Drive request, backing off through transient failures.
A thrown fetch never reached Drive at all, so only a status Drive itself chose
is retried; a 401 comes back for the UI to offer a reconnect, because renewing
the token needs a user gesture (#85). */
async function driveFetch(url: string, init: DriveRequest): Promise<DriveResult> {
  let lastStatus = 0;
  for (let attempt = 0; attempt < MAX_DRIVE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(backoffDelayMs(attempt - 1));
    let response: Response;
    try {
      response = await fetch(url, { ...init, headers: { ...authHeader(), ...init.headers } });
    } catch {
      return { outcome: 'unreachable', error: 'network error' };
    }
    const outcome = classifyDriveResponse(response.status, await throttleReason(response));
    if (outcome === 'ok') return { outcome: 'ok', response };
    lastStatus = response.status;
    if (outcome !== 'retry') return { outcome, error: `HTTP ${lastStatus}` };
  }
  return { outcome: 'fail', error: `HTTP ${lastStatus}` };
}

// Only an expired session is recoverable in place; the rest is reported as it stands (#85).
function failureReason(outcome: DriveFailure): 'auth-expired' | undefined {
  return outcome === 'auth-expired' ? 'auth-expired' : undefined;
}

function openFailureText(name: string, outcome: DriveFailure, error: string): string {
  if (outcome === 'auth-expired') {
    return `Your Google session expired. Sign in again to open ${name}.`;
  }
  if (outcome === 'unreachable') return `Network error while opening ${name}.`;
  return `Could not open ${name} (${error}).`;
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

/** Load GIS (once) and initialize the token client, wiring the token and error
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

/** Resolve a usable access token, prompting Google when it has to. Renders
nothing and navigates nowhere, so the sign-in screen and a mid-session
reconnect can both await it and then decide for themselves what to show; every
rejection carries an Error a caller can show as-is (#85). */
function getAccessToken(): Promise<string> {
  if (tokenRequest === null) {
    tokenRequest = requestToken();
    const clear = (): void => {
      tokenRequest = null;
      settleToken = null;
    };
    tokenRequest.then(clear, clear);
  }
  return tokenRequest;
}

async function requestToken(): Promise<string> {
  try {
    await ensureGis();
  } catch {
    gisReady = null; // let a retry re-load the script
    throw new Error('Could not load Google sign-in. Check your connection and try again.');
  }
  return new Promise<string>((resolve, reject) => {
    settleToken = { resolve, reject };
    // Opens Google's own sign-in popup; the result arrives at the callbacks below.
    must(tokenClient).requestAccessToken();
  });
}

async function onSignIn(): Promise<void> {
  try {
    await getAccessToken();
  } catch (error) {
    showSignInError((error as Error).message);
    return;
  }
  showChooser();
}

function handleTokenResponse(response: TokenResponse): void {
  const pending = settleToken;
  settleToken = null;
  if (typeof response.access_token === 'string' && response.access_token !== '') {
    accessToken = response.access_token;
    pending?.resolve(response.access_token);
    return;
  }
  pending?.reject(new Error('Google sign-in did not complete. Please try again.'));
}

function handleTokenError(error: TokenErrorResponse): void {
  const pending = settleToken;
  settleToken = null;
  pending?.reject(
    new Error(
      error.type === 'popup_failed_to_open'
        ? 'The sign-in popup was blocked. Allow popups for this site, then try again.'
        : 'Google sign-in was cancelled.',
    ),
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
  qs('[data-action="create-database"]').addEventListener('click', () => showHostForCreate());
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
  const result = await driveFetch(buildDriveDownloadUrl(DRIVE_API, file.id), {});
  if (result.outcome !== 'ok') {
    setPickStatus(openFailureText(file.name, result.outcome, result.error));
    return;
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await result.response.arrayBuffer();
  } catch {
    setPickStatus(`Network error while opening ${file.name}.`);
    return;
  }
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  const identified = identifyFormat(header);

  if (identified.kind === 'invalid') {
    setPickStatus(`${file.name} doesn't look like a KDBX file — no recognized signature found.`);
    return;
  }
  if (!identified.implementation) {
    setPickStatus(`${file.name} is ${identified.label}, which isn't supported yet.`);
    return;
  }
  showHost(file, bytes, identified.implementation);
}

// ============================================================
// Screen: Embedded app (0x67 in an iframe)
// ============================================================

function showHost(file: DriveFile, bytes: ArrayBuffer, implementation: string): void {
  currentFile = file;
  pendingAction = { kind: 'open', filename: file.name, bytes };
  embedApp(file.name, implementation);
}

// No file was picked — nothing to hand over, so the header shows a
// placeholder until the app's first save both names and creates the file.
function showHostForCreate(): void {
  currentFile = null;
  pendingAction = { kind: 'create' };
  embedApp('New database', APP_IMPLEMENTATION);
}

function embedApp(headerLabel: string, implementation: string): void {
  setRoot(cloneTemplate('tpl-host'));
  qs('#host-filename').textContent = headerLabel;
  qs('[data-action="back-to-drive"]').addEventListener('click', () => {
    requestCloseIframe();
  });
  window.addEventListener('message', handleFrameMessage);
  window.addEventListener('keydown', handleFindKey);
  // Setting src last means the iframe's script (and its kw-ready handshake)
  // can't fire before the listener above is attached.
  qs<HTMLIFrameElement>('#app-frame').src = implementation;
}

/* The app reports its lock state for the tab (#65); a find is only worth
forwarding once it is unlocked and has entries to look through (#78). */
let appUnlocked = false;

/* Focus outside the iframe means this document gets the keystroke, so the find
is forwarded rather than left to the browser's own, which can only see this
page's chrome (#78). */
function handleFindKey(event: KeyboardEvent): void {
  if (event.key !== 'f' || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey)) {
    return;
  }
  if (!appUnlocked) return;
  event.preventDefault();
  must(qs<HTMLIFrameElement>('#app-frame').contentWindow).postMessage(findMessage(), PEER.target);
}

function tearDownIframe(): void {
  window.removeEventListener('message', handleFrameMessage);
  window.removeEventListener('keydown', handleFindKey);
  appReady = false;
  appUnlocked = false;
  applyTabState(document, BASE_TITLE, '', true);
  currentFile = null;
  pendingAction = null;
  showChooser();
}

/* Ask the embedded app whether it's safe to remove the iframe; it may have
unsaved edits, in which case it confirms discard first and only sends kw-close
if the user agrees. A user who cancels sends nothing and the iframe stays, the
same as cancelling that dialog standalone (#83). */
function requestCloseIframe(): void {
  if (!appReady) {
    tearDownIframe();
    return;
  }
  must(qs<HTMLIFrameElement>('#app-frame').contentWindow).postMessage(
    closeRequestMessage(),
    PEER.target,
  );
}

function handleFrameMessage(event: MessageEvent): void {
  if (event.origin !== PEER.accept) return;
  const iframe = document.getElementById('app-frame') as HTMLIFrameElement | null;
  if (iframe === null || event.source === null || event.source !== iframe.contentWindow) return;

  const source = event.source as Window;
  if (isReadyMessage(event.data)) {
    appReady = true;
    const action = must(pendingAction);
    source.postMessage(
      action.kind === 'open' ? openMessage(action.filename, action.bytes) : createMessage(),
      PEER.target,
    );
  } else if (isSaveMessage(event.data)) {
    qs('#host-filename').textContent = event.data.filename;
    if (currentFile) {
      void saveToDrive(event.data.bytes, source);
    } else {
      void createFileOnDrive(event.data.filename, event.data.bytes, source);
    }
  } else if (isTitleMessage(event.data)) {
    appUnlocked = !event.data.locked;
    applyTabState(document, BASE_TITLE, event.data.filename, event.data.locked);
  } else if (isReconnectMessage(event.data)) {
    void reconnect(source);
  } else if (isCloseMessage(event.data)) {
    tearDownIframe();
  }
}

async function saveToDrive(bytes: ArrayBuffer, source: Window): Promise<void> {
  const file = must(currentFile);
  const result = await driveFetch(buildDriveUpdateUrl(UPLOAD_API, file.id), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (result.outcome === 'ok') {
    source.postMessage(savedMessage(true), PEER.target);
    return;
  }
  source.postMessage(savedMessage(false, result.error, failureReason(result.outcome)), PEER.target);
}

/** First save of a create-originated session: no Drive file exists yet, so
this creates one instead of the PATCH saveToDrive uses, then remembers it so
every later save in this session updates that same file. */
async function createFileOnDrive(
  filename: string,
  bytes: ArrayBuffer,
  source: Window,
): Promise<void> {
  const { body, boundary } = buildMultipartBody(filename, bytes);
  const result = await driveFetch(buildDriveCreateUrl(UPLOAD_API), {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (result.outcome !== 'ok') {
    source.postMessage(
      savedMessage(false, result.error, failureReason(result.outcome)),
      PEER.target,
    );
    return;
  }

  let created: { id: string };
  try {
    created = (await result.response.json()) as { id: string };
  } catch {
    // Drive made the file; without its id no later save can update that same one (#85).
    source.postMessage(savedMessage(false, 'unexpected response'), PEER.target);
    return;
  }
  currentFile = { id: created.id, name: filename };
  source.postMessage(savedMessage(true), PEER.target);
}

/** Renew the Google credential without leaving the host screen, so a save that
failed on an expired session can be retried with the edits still in the app (#85). */
async function reconnect(source: Window): Promise<void> {
  try {
    await getAccessToken();
  } catch (error) {
    source.postMessage(reconnectedMessage(false, (error as Error).message), PEER.target);
    return;
  }
  source.postMessage(reconnectedMessage(true), PEER.target);
}

function signOut(): void {
  accessToken = null;
  currentFile = null;
  pendingAction = null;
  showSignIn();
}

// ============================================================
// Boot
// ============================================================

showSignIn();
