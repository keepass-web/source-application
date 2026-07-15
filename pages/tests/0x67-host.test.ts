/**
 * Coverage for 0x67/page.ts's optional "Host integration" path — the code
 * that only runs when the app is embedded in a same-origin parent frame (the
 * cloud connector). 0x67-page.test.ts boots the app standalone (a top-level
 * jsdom window is its own parent, so isEmbedded() is false there); this file
 * boots a *fresh* copy with window.parent overridden to a mock, so the
 * handshake, host-driven open, and save-to-host write-back all execute.
 *
 * node:test runs each test file in its own process, so importing page.ts here
 * re-evaluates its module scope independently of the standalone file's import.
 *
 * Same two jsdom gaps as the standalone file: HTMLDialogElement.showModal()/
 * close() aren't implemented, so they get the same behavior-only polyfill.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  addEntryAttachment,
  appendChild,
  Credentials,
  createElement,
  createEntry,
  createGroup,
  deleteHistoryEntry,
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getEntryAttachments,
  getEntryHistory,
  getEntryTags,
  getEntryTimes,
  getText,
  isInRecycleBin,
  Kdbx,
  pushHistorySnapshot,
  removeEntryAttachment,
  renameEntryAttachment,
  restoreHistoryEntry,
  setAttribute,
  setEntryExpiry,
  setEntryTags,
  setText,
  touchLastModified,
} from '../../packages/kdbx/src/index.ts';
import * as logic from '../0x67/logic.ts';

// ============================================================
// jsdom environment with a mocked parent frame
// ============================================================

const htmlPath = fileURLToPath(new URL('../0x67/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });

// Every message the app posts "up" to its host lands here.
const hostInbox: Array<{ message: Record<string, unknown>; origin: string }> = [];
const parentMock = {
  postMessage(message: Record<string, unknown>, origin: string): void {
    hostInbox.push({ message, origin });
  },
};

// Make the app's window look framed: parent is the mock, not itself.
Object.defineProperty(dom.window, 'parent', { value: parentMock, configurable: true });

Object.defineProperty(globalThis, 'document', {
  value: dom.window.document as unknown as Document,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator as unknown as Navigator,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: dom.window as unknown as Window & typeof globalThis,
  configurable: true,
  writable: true,
});

// --- HTMLDialogElement polyfill (see file header) ---
dom.window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new dom.window.Event('close'));
};

Object.assign(globalThis, {
  Kdbx,
  Credentials,
  getChildren,
  getChild,
  getText,
  getAttribute,
  setAttribute,
  createElement,
  appendChild,
  setText,
  createEntry,
  createGroup,
  findOrCreateRecycleBin,
  isInRecycleBin,
  getEntryTags,
  setEntryTags,
  getEntryTimes,
  setEntryExpiry,
  touchLastModified,
  getEntryAttachments,
  addEntryAttachment,
  renameEntryAttachment,
  removeEntryAttachment,
  getEntryHistory,
  pushHistorySnapshot,
  restoreHistoryEntry,
  deleteHistoryEntry,
  ...logic,
});

await import('../0x67/page.ts');

// ============================================================
// Helpers
// ============================================================

const doc = dom.window.document;
const root = (): HTMLElement => doc.getElementById('root') as HTMLElement;
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;
const dq = <T extends Element = Element>(selector: string): T =>
  doc.querySelector<T>(selector) as T;

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function click(el: Element): void {
  el.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));
}

/** Deliver a message "from the host" as a plain Event with the fields
 * handleHostMessage reads — mirroring how 0x67-page.test.ts fabricates events
 * (MessageEvent's source must be a real Window, which a mock isn't). */
function sendFromHost(data: unknown, opts: { origin?: string; source?: unknown } = {}): void {
  const evt = new dom.window.Event('message');
  Object.assign(evt, {
    data,
    origin: opts.origin ?? 'https://example.com',
    source: 'source' in opts ? opts.source : parentMock,
  });
  dom.window.dispatchEvent(evt);
}

const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;
const PASSWORD = 'unit-test-password';

async function buildTestDatabase(): Promise<Uint8Array> {
  const kdbx = await Kdbx.create(new Credentials({ password: PASSWORD }), {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Host Vault',
  });
  appendChild(
    kdbx.getRootGroup(),
    createEntry({ title: 'Only Entry', username: 'u', password: 'p' }),
  );
  return kdbx.save();
}

const dbBytes = await buildTestDatabase();

const lastHostMessage = (): Record<string, unknown> =>
  hostInbox[hostInbox.length - 1]?.message as Record<string, unknown>;

// ============================================================
// The walkthrough
// ============================================================

test('0x67 embedded in a host frame', async (t) => {
  await t.test('announces readiness to the host on boot', () => {
    assert.equal(hostInbox.length, 1);
    assert.deepEqual(hostInbox[0]?.message, { type: 'kw-ready' });
    assert.equal(hostInbox[0]?.origin, 'https://example.com');
    // Still shows the normal upload screen underneath, untouched.
    assert.ok(q('#drop-zone'));
  });

  await t.test('ignores messages that fail the origin/source/shape checks', () => {
    const before = hostInbox.length;
    sendFromHost(
      { type: 'kw-open', filename: 'x.kdbx', bytes: new ArrayBuffer(4) },
      {
        origin: 'https://evil.example',
      },
    );
    sendFromHost(
      { type: 'kw-open', filename: 'x.kdbx', bytes: new ArrayBuffer(4) },
      {
        source: { not: 'the parent' },
      },
    );
    sendFromHost(null);
    sendFromHost('a string, not an object');
    sendFromHost({ type: 'kw-open', filename: 42, bytes: new ArrayBuffer(4) });
    sendFromHost({ type: 'kw-open', filename: 'x.kdbx', bytes: 'not a buffer' });
    sendFromHost({ type: 'something-else' });
    // A save result with nothing pending is a harmless no-op.
    sendFromHost({ type: 'kw-saved', ok: true });
    assert.ok(q('#drop-zone'), 'still on the upload screen; nothing opened');
    assert.equal(hostInbox.length, before, 'nothing posted back');
  });

  await t.test('kw-open loads the host-supplied vault into the unlock screen', async () => {
    sendFromHost({
      type: 'kw-open',
      filename: 'from-drive.kdbx',
      bytes: new Uint8Array(dbBytes).buffer,
    });
    await waitFor(() => q('#master-password') !== null);
    assert.equal(q<HTMLElement>('#db-filename').textContent, 'from-drive.kdbx');
  });

  await t.test('unlocks, and the save dialog offers Drive write-back, not download', async () => {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    q('#unlock-form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(() => q('#search-input') !== null);

    // Make an edit so the save dialog opens: add an entry, then save it.
    click(q('[data-action="add-entry"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);

    assert.equal(dq<HTMLElement>('[data-role="save-host"]').hidden, false);
    assert.equal(dq<HTMLElement>('[data-role="save-local"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, false);
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').hidden, true);
  });

  await t.test('Save to Drive posts kw-save, then reports success on kw-saved', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    await waitFor(() => hostInbox.length > before);

    const msg = lastHostMessage();
    assert.equal(msg.type, 'kw-save');
    assert.equal(msg.filename, 'from-drive.kdbx');
    assert.ok(msg.bytes instanceof ArrayBuffer && msg.bytes.byteLength > 0);
    assert.equal(
      dq<HTMLElement>('[data-role="save-status"]').textContent,
      'Saving to Google Drive…',
    );
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').disabled, true);

    sendFromHost({ type: 'kw-saved', ok: true });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    assert.equal(status.textContent, 'Saved to Google Drive.');
    assert.ok(status.classList.contains('ok'));
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').disabled, false);
  });

  await t.test('a failed write-back with an error message is surfaced', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 403' });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    assert.equal(status.textContent, 'Save failed: HTTP 403');
    assert.ok(status.classList.contains('error'));
  });

  await t.test(
    'a failed write-back with no error message falls back to a generic message',
    async () => {
      const before = hostInbox.length;
      click(dq('[data-action="save-host"]'));
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-saved', ok: false });
      assert.equal(dq<HTMLElement>('[data-role="save-status"]').textContent, 'Save failed.');
    },
  );
});
