/**
 * Behavioral tests for local/page.ts, driven through the real page.html
 * markup in jsdom. Combines what router-page.test.ts used to cover (drop a
 * file, detect its format) with what cloud-google-drive-page.test.ts covers
 * for the embedded-app message protocol, since local/page.ts now does both
 * in one page: read the file once, decide the implementation via
 * packages/router, then embed it and hand over the bytes — no re-selecting
 * the same file on a second page.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as embedProtocol from '../../packages/embed-protocol/src/index.ts';
import { identifyFormat } from '../../packages/router/src/index.ts';
import { must } from '../local/logic.ts';

const htmlPath = fileURLToPath(new URL('../local/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });
const APP_ORIGIN = 'https://example.com';

Object.defineProperty(globalThis, 'document', {
  value: dom.window.document as unknown as Document,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: dom.window as unknown as Window & typeof globalThis,
  configurable: true,
  writable: true,
});

// Anchor-click downloads would otherwise trip jsdom's "not implemented:
// navigation" — record the attempted filename instead, exactly like
// tests/0x67-page.test.ts does for its own download flow.
const downloadNames: string[] = [];
dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
  downloadNames.push(this.download);
};

Object.assign(globalThis, { identifyFormat, ...embedProtocol, must });

await import('../local/page.ts');

// ============================================================
// Helpers
// ============================================================

const doc = dom.window.document;
const root = (): HTMLElement => doc.getElementById('root') as HTMLElement;
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;

function dispatch(el: EventTarget, type: string, extra?: Record<string, unknown>): Event {
  const evt = new dom.window.Event(type, { bubbles: true, cancelable: true });
  if (extra) Object.assign(evt, extra);
  el.dispatchEvent(evt);
  return evt;
}

function click(el: Element): void {
  dispatch(el, 'click');
}

function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function makeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name);
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
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

function sendMessage(data: unknown, opts: { origin?: string; source?: unknown } = {}): void {
  const evt = new dom.window.Event('message');
  Object.assign(evt, {
    data,
    origin: opts.origin ?? APP_ORIGIN,
    source: 'source' in opts ? opts.source : dom.window,
  });
  dom.window.dispatchEvent(evt);
}

// ============================================================
// Walkthrough
// ============================================================

test('local file connector', async (t) => {
  await t.test('boots showing the drop zone, with the result panel hidden', () => {
    assert.equal(q<HTMLElement>('#drop-zone').hidden, false);
    assert.equal(q<HTMLElement>('#result').hidden, true);
  });

  await t.test('dragover/dragleave toggle the drag-over class', () => {
    const dropZone = q<HTMLElement>('#drop-zone');
    const over = dispatch(dropZone, 'dragover');
    assert.equal(over.defaultPrevented, true);
    assert.equal(dropZone.classList.contains('drag-over'), true);

    dispatch(dropZone, 'dragleave');
    assert.equal(dropZone.classList.contains('drag-over'), false);
  });

  await t.test('a drop event with no files does nothing', () => {
    dispatch(q<HTMLElement>('#drop-zone'), 'drop', { dataTransfer: { files: [] } });
    assert.equal(q<HTMLElement>('#result').hidden, true);
  });

  await t.test('a change event with no file selected does nothing', () => {
    setFiles(q<HTMLInputElement>('#file-input'), []);
    dispatch(q<HTMLInputElement>('#file-input'), 'change');
    assert.equal(q<HTMLElement>('#result').hidden, true);
  });

  await t.test('a file with no recognizable signature shows an error', async () => {
    setFiles(q<HTMLInputElement>('#file-input'), [
      makeFile('random.bin', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])),
    ]);
    dispatch(q<HTMLInputElement>('#file-input'), 'change');

    await waitFor(() => q<HTMLElement>('#result').hidden === false);
    assert.equal(q<HTMLElement>('#result').className, 'result result-error');
    assert.match(
      q<HTMLElement>('#result-message').textContent ?? '',
      /doesn't look like a KDBX file/,
    );
  });

  await t.test('choosing another file resets back to the drop zone', () => {
    click(q('#choose-another'));
    assert.equal(q<HTMLElement>('#drop-zone').hidden, false);
    assert.equal(q<HTMLElement>('#result').hidden, true);
    assert.equal(q<HTMLInputElement>('#file-input').value, '');
  });

  await t.test('a recognized-but-unsupported file (.kdb) warns, with no iframe', async () => {
    const dropZone = q<HTMLElement>('#drop-zone');
    const evt = dispatch(dropZone, 'drop', {
      dataTransfer: { files: [makeFile('old.kdb', header(0x65))] },
    });
    assert.equal(evt.defaultPrevented, true);

    await waitFor(() => q<HTMLElement>('#result').hidden === false);
    assert.equal(q<HTMLElement>('#result').className, 'result result-warn');
    assert.match(
      q<HTMLElement>('#result-message').textContent ?? '',
      /KeePass 1\.x \(\.kdb\), which isn't supported yet/,
    );
    click(q('#choose-another'));
  });

  await t.test('dropping a recognized file embeds its implementation', async () => {
    const dropZone = q<HTMLElement>('#drop-zone');
    dispatch(dropZone, 'drop', { dataTransfer: { files: [makeFile('vault.kdbx', header(0x67))] } });

    await waitFor(() => q('#app-frame') !== null);
    assert.equal(q<HTMLElement>('#host-filename').textContent, 'vault.kdbx');
    assert.equal(q<HTMLIFrameElement>('#app-frame').getAttribute('src'), '0x67.html');
  });

  // --- Embedded-app message protocol -------------------------------------

  const frameInbox: Array<{ message: Record<string, unknown>; origin: string }> = [];
  const frameWin = {
    postMessage(message: Record<string, unknown>, origin: string): void {
      frameInbox.push({ message, origin });
    },
  };

  await t.test('frame messages that fail the guard are ignored', () => {
    const frame = q<HTMLIFrameElement>('#app-frame');
    Object.defineProperty(frame, 'contentWindow', { value: frameWin, configurable: true });

    sendMessage({ type: 'kw-ready' }, { origin: 'https://evil.example', source: frameWin });
    sendMessage({ type: 'kw-ready' }, { source: null });
    sendMessage({ type: 'kw-ready' }, { source: { not: 'the frame' } });
    assert.equal(frameInbox.length, 0);
  });

  await t.test('kw-ready triggers kw-open with the file bytes', () => {
    sendMessage({ type: 'kw-ready' }, { source: frameWin });
    assert.equal(frameInbox.length, 1);
    const msg = frameInbox[0]?.message;
    assert.equal(msg?.type, 'kw-open');
    assert.equal(msg?.filename, 'vault.kdbx');
    assert.ok(msg?.bytes instanceof ArrayBuffer);
  });

  await t.test('kw-save triggers a local download and reports success', () => {
    const before = downloadNames.length;
    sendMessage(
      { type: 'kw-save', filename: 'vault.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    assert.deepEqual(downloadNames.slice(before), ['vault.kdbx']);
    assert.deepEqual(frameInbox.at(-1)?.message, { type: 'kw-saved', ok: true });
  });

  await t.test('a stray kw-close-ack with nothing pending is a harmless no-op', () => {
    const before = frameInbox.length;
    sendMessage({ type: 'kw-close-ack' }, { source: frameWin });
    assert.equal(frameInbox.length, before, 'nothing posted back');
    assert.ok(q('#app-frame'), 'still showing the host screen');
  });

  await t.test('back to chooser asks the app first, and only leaves once it acks', () => {
    click(q('[data-action="back-to-chooser"]'));
    assert.ok(q('#app-frame'), 'still on the host screen — waiting for the app to confirm');
    const req = frameInbox.at(-1)?.message;
    assert.equal(req?.type, 'kw-close-request');

    sendMessage({ type: 'kw-close-ack' }, { source: frameWin });
    assert.ok(q('#drop-zone'), 'now back at the chooser');
  });

  await t.test('a frame message after back to chooser completed is ignored', () => {
    const before = frameInbox.length;
    sendMessage({ type: 'kw-ready' }, { source: frameWin });
    assert.equal(frameInbox.length, before, 'nothing more posted — the iframe is gone');
  });

  await t.test('an app-initiated close tears down the iframe without a round trip', async () => {
    const dropZone = q<HTMLElement>('#drop-zone');
    dispatch(dropZone, 'drop', {
      dataTransfer: { files: [makeFile('vault2.kdbx', header(0x67))] },
    });
    await waitFor(() => q('#app-frame') !== null);
    Object.defineProperty(q<HTMLIFrameElement>('#app-frame'), 'contentWindow', {
      value: frameWin,
      configurable: true,
    });

    const before = frameInbox.length;
    sendMessage({ type: 'kw-close' }, { source: frameWin });
    assert.equal(frameInbox.length, before, 'no reply expected — the app already confirmed itself');
    assert.ok(q('#drop-zone'), 'back at the chooser, no request/ack round trip needed');
  });

  // --- Create a new database ----------------------------------------------

  await t.test(
    'creating a new database embeds the app with nothing to open, and kw-ready triggers kw-create',
    () => {
      click(q('[data-action="create-database"]'));
      assert.ok(q('#app-frame'));
      assert.equal(q<HTMLElement>('#host-filename').textContent, 'New database');
      assert.equal(q<HTMLIFrameElement>('#app-frame').getAttribute('src'), '0x67.html');

      Object.defineProperty(q<HTMLIFrameElement>('#app-frame'), 'contentWindow', {
        value: frameWin,
        configurable: true,
      });
      sendMessage({ type: 'kw-ready' }, { source: frameWin });
      assert.deepEqual(frameInbox.at(-1)?.message, { type: 'kw-create' });
    },
  );

  await t.test(
    'kw-save from a create session downloads under the chosen name and updates the header',
    () => {
      const before = downloadNames.length;
      sendMessage(
        { type: 'kw-save', filename: 'Fresh Vault.kdbx', bytes: new ArrayBuffer(8) },
        { source: frameWin },
      );
      assert.deepEqual(downloadNames.slice(before), ['Fresh Vault.kdbx']);
      assert.equal(q<HTMLElement>('#host-filename').textContent, 'Fresh Vault.kdbx');
      assert.deepEqual(frameInbox.at(-1)?.message, { type: 'kw-saved', ok: true });
    },
  );
});
