// ============================================================
// DOM helpers
// (must() is declared in globals.d.ts and supplied at runtime by logic.ts —
//  see globals.d.ts for why it lives there instead of here.)
// ============================================================

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return must(document.getElementById(id) as T | null);
}

// ============================================================
// Elements
// (This page has a single static screen, so — unlike 0x67/page.ts — these
//  are looked up once, not re-queried per screen render.)
// ============================================================

const dropZone = byId('drop-zone');
const fileInput = byId<HTMLInputElement>('file-input');
const resultEl = byId('result');
const resultMessage = byId('result-message');
const resultLink = byId<HTMLAnchorElement>('result-link');
const chooseAnotherBtn = byId('choose-another');

// ============================================================
// Result rendering
// ============================================================

function showResult(result: FormatResult): void {
  dropZone.hidden = true;
  resultEl.hidden = false;

  if (result.kind === 'invalid') {
    resultEl.className = 'result result-error';
    resultMessage.textContent =
      "This doesn't look like a KDBX file — no recognized signature was found.";
    resultLink.hidden = true;
    return;
  }

  if (result.page) {
    resultEl.className = 'result result-ok';
    resultMessage.textContent =
      `Recognized as ${result.label}. Open that page and select this same file again — ` +
      `nothing about it is uploaded automatically.`;
    resultLink.textContent = `Open ${result.page}`;
    resultLink.href = result.page;
    resultLink.hidden = false;
  } else {
    resultEl.className = 'result result-warn';
    resultMessage.textContent = `Recognized as ${result.label}, which isn't supported yet.`;
    resultLink.hidden = true;
  }
}

function reset(): void {
  resultEl.hidden = true;
  resultLink.hidden = true;
  dropZone.hidden = false;
  dropZone.classList.remove('drag-over');
  fileInput.value = '';
}

/** Read only the first 8 bytes of `file` — everything identifyFormat needs,
 * and nothing more; the rest of the file is never touched. */
async function handleFile(file: File): Promise<void> {
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  showResult(identifyFormat(header));
}

// ============================================================
// Events
// ============================================================

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) handleFile(f);
});

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
  if (f) handleFile(f);
});

chooseAnotherBtn.addEventListener('click', reset);
