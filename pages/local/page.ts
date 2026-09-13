/** Opens or creates a database on this computer: for opening, reads the file
once, routes it via packages/router to the matching implementation
(0x67.html), embeds it, and hands over the bytes (packages/embed-protocol);
for creating, embeds the same implementation with nothing to hand over and
lets it drive its own create-database screen — nothing leaves the browser
either way. Differs from Drive only in what "save" means: here, a download. */

const PEER = peerOrigin(window.location.protocol, window.location.origin);
// The only current KDBX implementation. Opening detects this from a file's
// bytes via packages/router; creating has no bytes to sniff, so it's named directly.
const APP_IMPLEMENTATION = '0x67.html';
// This page's own title, kept so closing the app can hand the tab back (#65).
const BASE_TITLE = document.title;

// --- In-memory state (never persisted) -------------------------------------

type PendingAction = { kind: 'open'; filename: string; bytes: ArrayBuffer } | { kind: 'create' };
let pendingAction: PendingAction | null = null;
/* Whether the embedded app has announced itself with kw-ready. A frame that
never did cannot answer a close request, and holds nothing the user reached
through this page, so it is removed without asking (#83). */
let appReady = false;

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

// Screen: Choose a file

function showChooser(): void {
  setRoot(cloneTemplate('tpl-chooser'));

  const dropZone = qs('#drop-zone');
  const fileInput = qs<HTMLInputElement>('#file-input');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const f = e.dataTransfer?.files[0];
    if (f) void handleFile(f);
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void handleFile(f);
  });
  qs('[data-action="create-database"]').addEventListener('click', () => showHostForCreate());
  qs('#choose-another').addEventListener('click', resetChooser);
}

function resetChooser(): void {
  qs<HTMLElement>('#result').hidden = true;
  const dropZone = qs<HTMLElement>('#drop-zone');
  dropZone.hidden = false;
  dropZone.classList.remove('drag-over');
  qs<HTMLInputElement>('#file-input').value = '';
}

function showMessage(message: string, kind: 'warn' | 'error'): void {
  qs<HTMLElement>('#drop-zone').hidden = true;
  const resultEl = qs<HTMLElement>('#result');
  resultEl.hidden = false;
  resultEl.className = `result result-${kind}`;
  qs('#result-message').textContent = message;
}

/** Read the whole file once: identifyFormat only needs the first 8 bytes, but
 * opening it needs the rest anyway, so there is no separate sniff-then-reread
 * step the way a link-based handoff would require. */
async function handleFile(file: File): Promise<void> {
  const bytes = await file.arrayBuffer();
  const header = new Uint8Array(bytes, 0, Math.min(8, bytes.byteLength));
  const result = identifyFormat(header);

  if (result.kind === 'invalid') {
    showMessage("This doesn't look like a KDBX file — no recognized signature was found.", 'error');
    return;
  }
  if (!result.implementation) {
    showMessage(`Recognized as ${result.label}, which isn't supported yet.`, 'warn');
    return;
  }
  showHost(file.name, bytes, result.implementation);
}

// Screen: Embedded implementation app

function showHost(filename: string, bytes: ArrayBuffer, implementation: string): void {
  pendingAction = { kind: 'open', filename, bytes };
  embedApp(filename, implementation);
}

// No file was chosen — nothing to hand over, so the header shows a
// placeholder until the app's first save tells this page the real name.
function showHostForCreate(): void {
  pendingAction = { kind: 'create' };
  embedApp('New database', APP_IMPLEMENTATION);
}

function embedApp(headerLabel: string, implementation: string): void {
  setRoot(cloneTemplate('tpl-host'));
  qs('#host-filename').textContent = headerLabel;
  qs('[data-action="back-to-chooser"]').addEventListener('click', () => {
    requestCloseIframe();
  });
  window.addEventListener('message', handleFrameMessage);
  window.addEventListener('keydown', handleFindKey);
  // src is set last so the iframe's kw-ready can't fire before the listener attaches.
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
    downloadAndAck(event.data.filename, event.data.bytes, source);
  } else if (isTitleMessage(event.data)) {
    appUnlocked = !event.data.locked;
    applyTabState(document, BASE_TITLE, event.data.filename, event.data.locked);
  } else if (isCloseMessage(event.data)) {
    tearDownIframe();
  }
}

/** Local "save" is a download — nowhere else to write to. Always succeeds
unless the browser itself refuses it (no error path, unlike Drive). */
function downloadAndAck(filename: string, bytes: ArrayBuffer, source: Window): void {
  const blob = new Blob([bytes]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  source.postMessage(savedMessage(true), PEER.target);
}

// Boot

showChooser();
