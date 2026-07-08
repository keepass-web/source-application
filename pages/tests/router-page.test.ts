/**
 * Behavioral tests for router/page.ts, the one file in this workspace that
 * touches real DOM APIs at module scope. Plain Node has no DOM, so
 * pages/tests/coverage.test.ts deliberately lets a bare import of it throw —
 * that's the honest signal that it had no test coverage at all.
 *
 * This file gives it real coverage instead, using jsdom (a devDependency
 * scoped to this workspace) to provide a `document`, exactly like
 * tests/0x67-page.test.ts does for the app page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { identifyFormat, must } from '../router/logic.ts';

const htmlPath = fileURLToPath(new URL('../router/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });

Object.defineProperty(globalThis, 'document', {
  value: dom.window.document as unknown as Document,
  configurable: true,
  writable: true,
});

// Hoist this page's own pure logic onto globalThis, exactly like bundle.js
// does in the real browser build (see bundle-iife.json's "exports" list).
Object.assign(globalThis, { identifyFormat, must });

await import('../router/page.ts');

// ============================================================
// Test helpers
// ============================================================

const doc = dom.window.document;
const byId = <T extends Element = Element>(id: string): T => doc.getElementById(id) as unknown as T;

function dispatch(el: EventTarget, type: string, extra?: Record<string, unknown>): Event {
  const evt = new dom.window.Event(type, { bubbles: true, cancelable: true });
  if (extra) Object.assign(evt, extra);
  el.dispatchEvent(evt);
  return evt;
}

function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function makeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name);
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Build a valid 8-byte KDBX-family header with the given secondary signature byte. */
function header(secondaryByte: number): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 0x9aa2d903, true);
  view.setUint32(4, 0xb54bfb00 | secondaryByte, true);
  return buf;
}

// ============================================================
// The walkthrough
// ============================================================

test('router page', async (t) => {
  await t.test('boots showing the drop zone, with the result panel hidden', () => {
    assert.equal(byId<HTMLElement>('drop-zone').hidden, false);
    assert.equal(byId<HTMLElement>('result').hidden, true);
  });

  await t.test('dragover/dragleave toggle the drag-over class', () => {
    const dropZone = byId<HTMLElement>('drop-zone');
    const over = dispatch(dropZone, 'dragover');
    assert.equal(over.defaultPrevented, true);
    assert.equal(dropZone.classList.contains('drag-over'), true);

    dispatch(dropZone, 'dragleave');
    assert.equal(dropZone.classList.contains('drag-over'), false);
  });

  await t.test('a drop event with no files does nothing', () => {
    const dropZone = byId<HTMLElement>('drop-zone');
    dispatch(dropZone, 'drop', { dataTransfer: { files: [] } });
    assert.equal(byId<HTMLElement>('result').hidden, true);
  });

  await t.test('a change event with no file selected does nothing', () => {
    const fileInput = byId<HTMLInputElement>('file-input');
    setFiles(fileInput, []);
    dispatch(fileInput, 'change');
    assert.equal(byId<HTMLElement>('result').hidden, true);
  });

  await t.test('dropping a recognized 0x67 file shows a link to open it', async () => {
    const dropZone = byId<HTMLElement>('drop-zone');
    const file = makeFile('vault.kdbx', header(0x67));
    const evt = dispatch(dropZone, 'drop', { dataTransfer: { files: [file] } });
    assert.equal(evt.defaultPrevented, true);
    assert.equal(dropZone.classList.contains('drag-over'), false);

    await waitFor(() => byId<HTMLElement>('result').hidden === false);
    assert.equal(byId<HTMLElement>('drop-zone').hidden, true);
    assert.equal(byId<HTMLElement>('result').className, 'result result-ok');

    const link = byId<HTMLAnchorElement>('result-link');
    assert.equal(link.hidden, false);
    assert.equal(link.getAttribute('href'), '0x67.html');
    assert.match(
      byId<HTMLElement>('result-message').textContent ?? '',
      /Recognized as KDBX 3\.1 \/ 4\.x\. Open that page/,
    );
  });

  await t.test('choosing another file resets back to the drop zone', () => {
    byId<HTMLElement>('choose-another').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(byId<HTMLElement>('drop-zone').hidden, false);
    assert.equal(byId<HTMLElement>('result').hidden, true);
    assert.equal(byId<HTMLAnchorElement>('result-link').hidden, true);
    assert.equal(byId<HTMLInputElement>('file-input').value, '');
  });

  await t.test(
    'choosing a recognized-but-unsupported file (.kdb) warns, with no link',
    async () => {
      const fileInput = byId<HTMLInputElement>('file-input');
      setFiles(fileInput, [makeFile('old.kdb', header(0x65))]);
      dispatch(fileInput, 'change');

      await waitFor(() => byId<HTMLElement>('result').hidden === false);
      assert.equal(byId<HTMLElement>('result').className, 'result result-warn');
      assert.equal(byId<HTMLAnchorElement>('result-link').hidden, true);
      assert.match(
        byId<HTMLElement>('result-message').textContent ?? '',
        /KeePass 1\.x \(\.kdb\), which isn't supported yet/,
      );

      byId<HTMLElement>('choose-another').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
    },
  );

  await t.test('choosing a file with no recognizable signature shows an error', async () => {
    const fileInput = byId<HTMLInputElement>('file-input');
    setFiles(fileInput, [makeFile('random.bin', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))]);
    dispatch(fileInput, 'change');

    await waitFor(() => byId<HTMLElement>('result').hidden === false);
    assert.equal(byId<HTMLElement>('result').className, 'result result-error');
    assert.equal(byId<HTMLAnchorElement>('result-link').hidden, true);
    assert.match(
      byId<HTMLElement>('result-message').textContent ?? '',
      /doesn't look like a KDBX file/,
    );
  });
});
