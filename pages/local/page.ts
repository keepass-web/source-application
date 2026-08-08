/** Opens a database from this computer: reads the file once, routes it via
packages/router to the matching implementation (0x67.html), embeds it,
and hands over the bytes (packages/embed-protocol) — nothing leaves the
browser. Differs from Drive only in what "save" means: here, a download. */

const APP_ORIGIN = window.location.origin;

// --- In-memory state (never persisted) -------------------------------------

let pendingOpen: { filename: string; bytes: ArrayBuffer } | null = null;
// Set while waiting for a kw-close-ack, so handleFrameMessage knows what to run once safe.
let pendingClose: (() => void) | null = null;

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
  pendingOpen = { filename, bytes };
  setRoot(cloneTemplate('tpl-host'));
  qs('#host-filename').textContent = filename;
  qs('[data-action="back-to-chooser"]').addEventListener('click', () => {
    requestCloseIframe(tearDownIframe);
  });
  window.addEventListener('message', handleFrameMessage);
  // src is set last so the iframe's kw-ready can't fire before the listener attaches.
  qs<HTMLIFrameElement>('#app-frame').src = implementation;
}

function tearDownIframe(): void {
  window.removeEventListener('message', handleFrameMessage);
  pendingOpen = null;
  showChooser();
}

// Ask the embedded app if it's safe to remove the iframe (it may confirm discard first).
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
  source.postMessage(savedMessage(true), APP_ORIGIN);
}

// Boot

showChooser();
