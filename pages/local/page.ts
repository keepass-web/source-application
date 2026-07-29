// ============================================================
// Local file connector
// ============================================================
//
// Opens a KeePass database from this computer: the user drops or chooses a
// file, its bytes are read once, right here in this tab, and packages/router
// decides which implementation understands them. On a match, that
// implementation (currently only 0x67) is embedded in an iframe and handed
// the bytes over the same postMessage protocol the Google Drive connector
// uses (see packages/embed-protocol) — no second file picker, no re-reading
// the file, and nothing ever leaves the browser.
//
// The only way this differs from the Drive connector is what "save" means:
// Drive persists back to the Drive API, whereas here there is nowhere to
// persist to — save means downloading the updated bytes, exactly like 0x67's
// own standalone save flow already does. That is the one piece of this
// connector that is genuinely local-specific; everything else (the iframe
// lifecycle, the message guards, the close handshake) is shared with Drive.
//
// (must is declared in globals.d.ts and supplied at runtime by logic.ts;
//  identifyFormat comes from packages/router and the kw-* message helpers
//  from packages/embed-protocol — bundle-iife concatenates all of them
//  alongside this file. See globals.d.ts.)

const APP_ORIGIN = window.location.origin;

// --- In-memory state (never persisted) -------------------------------------

let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;
// Set while waiting for the embedded app to ack a kw-close-request, so
// handleFrameMessage knows what to run once it's safe to tear the iframe down.
let pendingClose: (() => void) | null = null;

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

// ============================================================
// Screen: Choose a file
// ============================================================

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

// ============================================================
// Screen: Embedded implementation app
// ============================================================

function showHost(filename: string, bytes: ArrayBuffer, implementation: string): void {
  pendingOpen = { filename, bytes };
  setRoot(cloneTemplate('tpl-host'));
  qs('#host-filename').textContent = filename;
  qs('[data-action="back-to-chooser"]').addEventListener('click', () => {
    requestCloseIframe(tearDownIframe);
  });
  window.addEventListener('message', handleFrameMessage);
  // Setting src last means the iframe's script (and its kw-ready handshake)
  // can't fire before the listener above is attached.
  qs<HTMLIFrameElement>('#app-frame').src = implementation;
}

function tearDownIframe(): void {
  window.removeEventListener('message', handleFrameMessage);
  pendingOpen = null;
  showChooser();
}

/** Ask the embedded app whether it's safe to remove the iframe — it may have
 * unsaved edits, in which case it shows its own discard-confirmation dialog
 * and only acks if the user agrees. */
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
    downloadAndAck(event.data.filename, event.data.bytes, source);
  } else if (isCloseAckMessage(event.data)) {
    const afterClose = pendingClose;
    pendingClose = null;
    afterClose?.();
  } else if (isCloseMessage(event.data)) {
    // App-initiated (its own ✕ button) — no request/ack round-trip needed.
    tearDownIframe();
  }
}

/** Local "save" is a download: there is no remembered location to write back
 * to, so the closest equivalent to Drive's write-back is the same
 * Blob-download 0x67 already does standalone. This always succeeds unless the
 * browser itself refuses the download, so — unlike Drive's saveToDrive —
 * there is no error path to report back. */
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
  source.postMessage(savedMessage(true), APP_ORIGIN);
}

// ============================================================
// Boot
// ============================================================

showChooser();
