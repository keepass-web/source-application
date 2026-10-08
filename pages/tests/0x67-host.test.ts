/**
 * Coverage for 0x67/page.ts's optional "Host integration" path — the code
 * that only runs when the app is embedded in an equivalent-origin parent frame (the
 * cloud connector). 0x67-page.test.ts boots the app standalone (a top-level
 * jsdom window is its own parent, so isEmbedded() is false there); this file
 * boots a *fresh* copy with window.parent overridden to a mock, so the
 * handshake, host-driven open, and save-to-host write-back all execute.
 *
 * node:test runs each test file in its own process, so importing page.ts here
 * re-evaluates its module scope independently of the standalone file's import.
 *
 * Same jsdom gaps as the standalone file: HTMLDialogElement.showModal()/
 * close() and the Clipboard API aren't implemented, so they get the same
 * behavior-only polyfills.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as embedProtocol from '../../packages/embed-protocol/src/index.ts';
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
  type KdbxCreateOptions,
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
import { applyTabState } from '../shared/logic.ts';

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

// --- Clipboard polyfill (see file header); when held, writes wait for the test to land them ---
let clipboardText = '';
let heldClipboardWrites: Array<() => void> | null = null;
(
  dom.window.navigator as unknown as { clipboard: { writeText(text: string): Promise<void> } }
).clipboard = {
  writeText(text: string): Promise<void> {
    const held = heldClipboardWrites;
    if (!held) {
      clipboardText = text;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      held.push(() => {
        clipboardText = text;
        resolve();
      });
    });
  },
};

Object.assign(globalThis, {
  applyTabState,
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
  ...embedProtocol,
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

// kw-close waits its turn behind any clipboard write (#88), so it lands a few microtasks later.
const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

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
    // Only kw-ready: until a host answers, this app does not yet know it has one,
    // so it keeps its own title rather than telling anyone to set theirs (#83).
    assert.equal(hostInbox.length, 1);
    assert.deepEqual(hostInbox[0]?.message, { type: 'kw-ready' });
    assert.equal(hostInbox[0]?.origin, 'https://example.com');
    // Still shows the normal upload screen underneath, untouched.
    assert.ok(q('#drop-zone'));
    assert.ok(doc.body.classList.contains('embedded')); // suppresses this document's own footer
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

  await t.test('kw-close-request with nothing open acks receipt, then closes at once', async () => {
    const before = hostInbox.length;
    sendFromHost({ type: 'kw-close-request' });
    await settle();
    assert.equal(hostInbox.length, before + 2, 'no database in the tab, nothing to ask about');
    assert.deepEqual(hostInbox[before]?.message, { type: 'kw-close-ack' });
    assert.deepEqual(lastHostMessage(), { type: 'kw-close' });
    assert.equal(dq<HTMLDialogElement>('#dlg-confirm-discard').open, false);
  });

  await t.test('kw-open loads the host-supplied vault into the unlock screen', async () => {
    sendFromHost({
      type: 'kw-open',
      filename: 'from-drive.kdbx',
      bytes: new Uint8Array(dbBytes).buffer,
    });
    await waitFor(() => q('#master-password') !== null);
    assert.equal(q<HTMLElement>('#db-filename').textContent, 'from-drive.kdbx');
    assert.deepEqual(lastHostMessage(), {
      type: 'kw-title',
      filename: 'from-drive.kdbx',
      locked: true,
    });
  });

  await t.test('unlocks, and the save dialog offers host write-back, not download', async () => {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    q('#unlock-form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(() => q('#search-input') !== null);
    assert.deepEqual(lastHostMessage(), {
      type: 'kw-title',
      filename: 'from-drive.kdbx',
      locked: false,
    });

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

  await t.test('Save posts kw-save to the host, then reports success on kw-saved', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    await waitFor(() => hostInbox.length > before);

    const msg = lastHostMessage();
    assert.equal(msg.type, 'kw-save');
    assert.equal(msg.filename, 'from-drive.kdbx');
    assert.ok(msg.bytes instanceof ArrayBuffer && msg.bytes.byteLength > 0);
    assert.equal(dq<HTMLElement>('[data-role="save-status"]').textContent, 'Saving…');
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').disabled, true);
    /* A save in flight owns the one slot its reply lands in, so dismissing and
    starting another would leave the first to settle the second's wait (#85). */
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, true);

    sendFromHost({ type: 'kw-saved', ok: true });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => status.textContent === 'Saved.');
    assert.ok(status.classList.contains('ok'));
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').disabled, false);
    // Success collapses the footer to a single "Close" action — retrying
    // makes no sense once the write-back has already succeeded.
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').textContent, 'Close');
  });

  await t.test('reopening the save dialog for a new edit resets the footer', async () => {
    click(dq('[data-role="save-later"]')); // labeled "Close" now; still dismisses
    click(q('[data-action="edit"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);

    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').textContent, 'Later');
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, false);
  });

  await t.test(
    'a failed write-back with an error message is surfaced, leaving the footer as-is for a retry',
    async () => {
      const before = hostInbox.length;
      click(dq('[data-action="save-host"]'));
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 403' });
      const status = dq<HTMLElement>('[data-role="save-status"]');
      await waitFor(() => status.textContent === 'Save failed: HTTP 403');
      assert.ok(status.classList.contains('error'));
      assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').textContent, 'Later');
      assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, false);
    },
  );

  await t.test(
    'a failed write-back with no error message falls back to a generic message',
    async () => {
      const before = hostInbox.length;
      click(dq('[data-action="save-host"]'));
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-saved', ok: false });
      const status = dq<HTMLElement>('[data-role="save-status"]');
      await waitFor(() => status.textContent === 'Save failed.');
    },
  );

  await t.test(
    'retrying after a failure and succeeding clears dirty and collapses the footer',
    async () => {
      const before = hostInbox.length;
      click(dq('[data-action="save-host"]'));
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-saved', ok: true });
      const status = dq<HTMLElement>('[data-role="save-status"]');
      await waitFor(() => status.textContent === 'Saved.');
      assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').textContent, 'Close');
      click(dq('[data-role="save-later"]'));
    },
  );

  // --- An expired host session (#85) ---------------------------------------

  /** Make an edit and reopen the save dialog, so the next save has something to write. */
  async function editAndOpenSaveDialog(): Promise<void> {
    click(q('[data-action="edit"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
  }

  async function saveAwaitingHost(): Promise<void> {
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    await waitFor(() => hostInbox.length > before);
  }

  await t.test(
    'an expired host session offers reconnect and download, and nothing else',
    async () => {
      await editAndOpenSaveDialog();
      await saveAwaitingHost();
      sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });

      const status = dq<HTMLElement>('[data-role="save-status"]');
      await waitFor(() =>
        /session with the storage provider expired/.test(status.textContent ?? ''),
      );
      assert.ok(status.classList.contains('error'));
      assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, false);
      const download = dq<HTMLButtonElement>('[data-action="download"]');
      assert.equal(download.hidden, false, 'a copy can always be taken out');
      assert.equal(download.textContent, 'Download a copy');
      assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, true);
      const dismiss =
        dq<HTMLDialogElement>('#dlg-save').querySelectorAll<HTMLButtonElement>(
          '[data-action="close"]',
        );
      for (const btn of dismiss) {
        assert.equal(btn.hidden, true, 'nothing dismisses the dialog while the edits are stranded');
      }
    },
  );

  await t.test('Escape cannot dismiss the dialog while the session is expired', () => {
    const event = new dom.window.Event('cancel', { cancelable: true });
    dq<HTMLDialogElement>('#dlg-save').dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  });

  await t.test('downloading a copy takes the edits out without closing the way back', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const realCreate = URL.createObjectURL.bind(URL);
    const realRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = realCreate(obj);
      created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
      realRevoke(url);
    };
    try {
      click(dq('#dlg-save [data-action="download"]'));
      await waitFor(() => created.length === 1);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    assert.deepEqual(revoked, created);
    assert.equal(dq<HTMLDialogElement>('#dlg-save').open, true, 'reconnecting is still on offer');
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, false);
  });

  await t.test('a refused reconnect leaves both ways out standing', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    assert.deepEqual(hostInbox.at(-1)?.message, { type: 'kw-reconnect' });

    sendFromHost({ type: 'kw-reconnected', ok: false, error: 'popup blocked' });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => status.textContent === 'Reconnect failed: popup blocked');
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, false);
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').hidden, false);
  });

  await t.test('a refused reconnect with no message falls back to a generic one', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-reconnected', ok: false });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => status.textContent === 'Reconnect failed.');
  });

  await t.test('a successful reconnect retries the save on its own', async () => {
    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    // Neither way forward may start a second flow while this one is out (#85).
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').disabled, true);
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').disabled, true);
    sendFromHost({ type: 'kw-reconnected', ok: true });

    // The app re-sends its own save rather than the host holding the bytes (#85).
    await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-save');
    sendFromHost({ type: 'kw-saved', ok: true });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => status.textContent === 'Saved.');
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').hidden, true);
    // A save that landed collapses the footer; unlocking the dialog must not undo that.
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').textContent, 'Close');
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, false);
    click(dq('[data-role="save-later"]'));
  });

  await t.test('a plain failure after reconnecting leaves Save reachable again', async () => {
    await editAndOpenSaveDialog();
    await saveAwaitingHost();
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => /session with the storage provider expired/.test(status.textContent ?? ''));

    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-reconnected', ok: true });
    await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-save');
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 500' });

    await waitFor(() => status.textContent === 'Save failed: HTTP 500');
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, false);
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, false);
    click(dq('[data-role="save-later"]'));
  });

  const discardDlg = (selector: string): HTMLButtonElement =>
    dq<HTMLButtonElement>(`#dlg-confirm-discard ${selector}`);

  await t.test('an expired session in the discard prompt offers the same way out', async () => {
    await editAndOpenSaveDialog();
    click(dq('[data-role="save-later"]')); // dismiss without saving, so the edits stay unsaved
    sendFromHost({ type: 'kw-close-request' });
    await waitFor(() => dq<HTMLDialogElement>('#dlg-confirm-discard').open);

    const before = hostInbox.length;
    click(discardDlg('[data-action="confirm-save"]'));
    await waitFor(() => hostInbox.length > before);
    /* This prompt runs proceed() on success, so a cancel landing mid-save would
    close a database the user just backed out of (#85). */
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, true);
    assert.equal(discardDlg('[data-action="confirm-discard"]').hidden, true);
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });

    const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() => /session with the storage provider expired/.test(status.textContent ?? ''));
    assert.equal(discardDlg('[data-action="reconnect"]').hidden, false);
    assert.equal(discardDlg('[data-action="download"]').hidden, false);
    assert.equal(
      discardDlg('[data-action="confirm-discard"]').hidden,
      true,
      'discarding is what loses the edits, so it goes with the rest',
    );
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, true);
  });

  await t.test('downloading from the discard prompt lets the user leave again', async () => {
    const realCreate = URL.createObjectURL.bind(URL);
    const created: string[] = [];
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const url = realCreate(obj);
      created.push(url);
      return url;
    };
    try {
      click(discardDlg('[data-action="download"]'));
      await waitFor(() => created.length === 1);
    } finally {
      URL.createObjectURL = realCreate;
    }
    await waitFor(() => !discardDlg('[data-action="confirm-discard"]').hidden);
    assert.equal(discardDlg('[data-action="confirm-discard"]').disabled, false);
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, false);
    assert.equal(discardDlg('[data-action="cancel-discard"]').disabled, false);
  });

  await t.test('a retry that hits the same expired session stays locked', async () => {
    const before = hostInbox.length;
    click(discardDlg('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-reconnected', ok: true });
    await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-save');
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });

    await waitFor(() => !discardDlg('[data-action="reconnect"]').hidden);
    assert.equal(
      discardDlg('[data-action="cancel-discard"]').hidden,
      true,
      'the lock the retry just set stands, rather than being released by the reconnect that ran it',
    );
  });

  await t.test(
    'reconnecting from the discard prompt saves and lets the close through',
    async () => {
      const before = hostInbox.length;
      click(discardDlg('[data-action="reconnect"]'));
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-reconnected', ok: true });
      await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-save');

      /* The retry is in flight here: nothing may dismiss the prompt, or the
      success path below closes a database the user just said to keep (#85). */
      assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, true);
      assert.equal(discardDlg('[data-action="confirm-discard"]').hidden, true);

      sendFromHost({ type: 'kw-saved', ok: true });
      await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-close');
      assert.equal(dq<HTMLDialogElement>('#dlg-confirm-discard').open, false);
    },
  );

  await t.test('kw-close-request still asks when the database is saved', async () => {
    // The retry above succeeded and its dialog was closed, so nothing is
    // unsaved — but the open database itself is still worth a question.
    const before = hostInbox.length;
    sendFromHost({ type: 'kw-close-request' });
    assert.equal(hostInbox.length, before + 1, 'receipt is immediate; the outcome is not');
    assert.deepEqual(lastHostMessage(), { type: 'kw-close-ack' });
    const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
    assert.equal(dlg.open, true);
    /* Reopening resets every control, so an expired flow that hid Discard and
    Cancel earlier cannot leave this prompt missing them (#85). */
    assert.equal(discardDlg('[data-action="confirm-discard"]').hidden, false);
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, false);
    assert.equal(discardDlg('[data-action="reconnect"]').hidden, true);
    assert.equal(discardDlg('[data-action="download"]').hidden, true);
    assert.equal(dq<HTMLElement>('#confirm-discard-title').textContent, 'Close this database?');

    click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
    assert.equal(dlg.open, false);
    await settle();
    assert.deepEqual(lastHostMessage(), { type: 'kw-close' });
  });

  await t.test(
    'kw-close-request with unsaved changes opens the confirm dialog; confirming closes',
    async () => {
      // The walkthrough above left us on the entry-detail screen (commitEdits
      // returns there); back to the list, where a fresh edit can be made.
      click(q('[data-action="back"]'));
      click(q('[data-action="add-entry"]'));

      const before = hostInbox.length;
      sendFromHost({ type: 'kw-close-request' });
      assert.equal(hostInbox.length, before + 1, 'receipt is immediate; the outcome is not');
      assert.deepEqual(lastHostMessage(), { type: 'kw-close-ack' });
      const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
      assert.equal(dlg.open, true);

      click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
      assert.equal(dlg.open, false);
      await settle();
      assert.equal(hostInbox.length, before + 2);
      assert.deepEqual(lastHostMessage(), { type: 'kw-close' });
    },
  );

  await t.test("the app's own close button sends kw-close, unprompted by the host", async () => {
    // The prior test left the unsaved add-entry draft open (its own
    // confirm-discard was for the host's kw-close-request, which doesn't
    // navigate away) — cancel it to get back to the entry list. Cancelling a
    // new entry doesn't clear app.dirty, so this still exercises the
    // confirm-discard path below, same as standalone.
    click(q('[data-action="cancel"]'));

    // A value on the clipboard must be cleared before the host tears the frame
    // down, or the teardown takes the clear with it and leaves the value (#88).
    const copyHint = q('.copy-hint');
    assert.ok(copyHint, 'the entry list offers a copy control');
    click(copyHint);
    await settle();
    assert.notEqual(clipboardText, '', 'something is on the clipboard');
    const held: Array<() => void> = [];
    heldClipboardWrites = held;

    const before = hostInbox.length;
    click(q('[data-action="close"]'));
    const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
    assert.equal(dlg.open, true);
    click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
    await settle();
    assert.equal(held.length, 1, 'the clear is in flight');
    assert.equal(hostInbox.length, before, 'so the close waits for it');

    heldClipboardWrites = null;
    held[0]?.();
    await settle();
    assert.equal(clipboardText, '');
    assert.equal(hostInbox.length, before + 1);
    assert.deepEqual(lastHostMessage(), { type: 'kw-close' });
  });
});

test('0x67 embedded in a host frame: kw-create starts a fresh, empty database', async (t) => {
  await t.test(
    'kw-create shows the create-database screen, overriding whatever was showing, with no reply expected',
    () => {
      const before = hostInbox.length;
      sendFromHost({ type: 'kw-create' });
      assert.equal(hostInbox.length, before + 1, 'only the title, no round trip to the host');
      // Nothing is open until the database is actually created.
      assert.deepEqual(lastHostMessage(), { type: 'kw-title', filename: '', locked: true });
      assert.ok(q('#create-form'));
      assert.equal(q('#drop-zone'), null);
      assert.equal(q('#master-password'), null);
    },
  );

  await t.test(
    'creating lands on an empty entry list, and the save dialog offers host write-back, not download',
    async () => {
      // showCreateDatabase() always uses default (production) Argon2 cost, and
      // the save below re-derives the key under those same params — swap in
      // FAST_ARGON2 for just this one call so the save doesn't pay a
      // multi-second KDF cost, same fix buildTestDatabase() applies above.
      const realCreate = Kdbx.create;
      Kdbx.create = (credentials: Credentials, options?: KdbxCreateOptions) =>
        realCreate(credentials, { ...options, argon2: FAST_ARGON2, aesKdfRounds: 1000n });
      try {
        q<HTMLInputElement>('#create-name').value = 'Host-Created Vault';
        q<HTMLInputElement>('#create-password').value = PASSWORD;
        q<HTMLInputElement>('#create-password-confirm').value = PASSWORD;
        q('#create-form').dispatchEvent(
          new dom.window.Event('submit', { bubbles: true, cancelable: true }),
        );
        await waitFor(() => q('#search-input') !== null);
      } finally {
        Kdbx.create = realCreate;
      }

      // Make an edit so the save dialog opens, same as the kw-open walkthrough above.
      click(q('[data-action="add-entry"]'));
      await waitFor(() => q('[data-action="save"]') !== null);
      click(q('[data-action="save"]'));
      await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);

      assert.equal(dq<HTMLElement>('[data-role="save-host"]').hidden, false);
      assert.equal(dq<HTMLElement>('[data-role="save-local"]').hidden, true);
    },
  );

  await t.test(
    'Save posts kw-save with the name chosen at creation, then reports success on kw-saved',
    async () => {
      const before = hostInbox.length;
      click(dq('[data-action="save-host"]'));
      await waitFor(() => hostInbox.length > before);

      const msg = lastHostMessage();
      assert.equal(msg.type, 'kw-save');
      assert.equal(msg.filename, 'Host-Created Vault.kdbx');
      assert.ok(msg.bytes instanceof ArrayBuffer && msg.bytes.byteLength > 0);

      sendFromHost({ type: 'kw-saved', ok: true });
      const status = dq<HTMLElement>('[data-role="save-status"]');
      await waitFor(() => status.textContent === 'Saved.');
    },
  );
});

test('0x67 embedded in a host frame: choosing Save from the unsaved-changes prompt', async (t) => {
  await t.test(
    'a failed write-back leaves the prompt open, buttons re-enabled, for a retry',
    async () => {
      // The previous test left the save dialog open (footer collapsed to
      // "Close") on top of the entry-detail screen — dismiss both to reach the
      // entry list, where "add entry" lives.
      click(dq('[data-role="save-later"]'));
      click(q('[data-action="back"]'));
      click(q('[data-action="add-entry"]'));
      await waitFor(() => q('[data-action="save"]') !== null);
      click(q('[data-action="cancel"]')); // an unsaved (dirty) new entry, never committed

      click(q('[data-action="close"]'));
      const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
      await waitFor(() => dlg.open);
      assert.equal(
        dq<HTMLElement>('#confirm-discard-title').textContent,
        'Discard unsaved changes?',
      );
      const saveBtn = dq<HTMLButtonElement>('[data-action="confirm-save"]');
      assert.equal(saveBtn.textContent, 'Save', 'a host session offers Save, not Download');

      const before = hostInbox.length;
      click(saveBtn);
      await waitFor(() => hostInbox.length > before);
      assert.equal(saveBtn.disabled, true);
      assert.equal(dq<HTMLButtonElement>('[data-action="confirm-discard"]').disabled, true);

      sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 500' });
      const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
      await waitFor(() => status.textContent === 'Save failed: HTTP 500');
      assert.ok(status.classList.contains('error'));
      assert.equal(dlg.open, true, 'stays open so the user can retry or choose Discard instead');
      assert.equal(saveBtn.disabled, false);
      assert.equal(dq<HTMLButtonElement>('[data-action="confirm-discard"]').disabled, false);
    },
  );

  await t.test('a failure with no error message falls back to a generic one', async () => {
    const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
    const saveBtn = dq<HTMLButtonElement>('[data-action="confirm-save"]');
    const before = hostInbox.length;
    click(saveBtn);
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-saved', ok: false });
    const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() => status.textContent === 'Save failed.');
    assert.equal(dlg.open, true);
  });

  await t.test(
    'retrying and succeeding closes the prompt and proceeds with the action',
    async () => {
      const dlg = dq<HTMLDialogElement>('#dlg-confirm-discard');
      const saveBtn = dq<HTMLButtonElement>('[data-action="confirm-save"]');
      const before = hostInbox.length;
      click(saveBtn);
      await waitFor(() => hostInbox.length > before);
      sendFromHost({ type: 'kw-saved', ok: true });
      await waitFor(() => dlg.open === false);
      assert.deepEqual(lastHostMessage(), { type: 'kw-close' }, 'Close was the pending action');
    },
  );
});

test('0x67 embedded in a host frame: the host forwards the find keystroke', async (t) => {
  await t.test('kw-find puts the caret in the search field', async () => {
    // Focus outside the iframe means the host is the one that receives the
    // keystroke, so what crosses to the app is the message, not the key (#78).
    sendFromHost({
      type: 'kw-open',
      filename: 'find-me.kdbx',
      bytes: new Uint8Array(dbBytes).buffer,
    });
    await waitFor(() => q('#master-password') !== null);
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    q('#unlock-form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(() => q('#search-input') !== null);

    q<HTMLInputElement>('#search-input').blur();
    assert.notEqual(dom.window.document.activeElement, q('#search-input'));

    sendFromHost({ type: 'kw-find' });
    assert.equal(dom.window.document.activeElement, q('#search-input'));
  });

  // --- Reconnects that never come back (#85) --------------------------------

  /** Collapse the app's minute-scale waits so a test can reach them. `waitFor`
   * polls at 5ms, so only the long ones are shortened. */
  function fastLongTimers(target: { setTimeout: typeof setTimeout }): () => void {
    const real = target.setTimeout;
    target.setTimeout = ((fn: () => void, ms?: number) =>
      real(fn, ms !== undefined && ms >= 1000 ? 0 : ms)) as typeof setTimeout;
    return () => {
      target.setTimeout = real;
    };
  }

  async function reachExpiredSave(): Promise<void> {
    // The find test leaves the entry list up, so add an entry to make an edit.
    click(q('[data-action="add-entry"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });
    await waitFor(() =>
      /session with the storage provider expired/.test(
        dq<HTMLElement>('[data-role="save-status"]').textContent ?? '',
      ),
    );
  }

  await t.test(
    'a host that never answers gives the dialog back rather than sealing it',
    async () => {
      await reachExpiredSave();
      const status = dq<HTMLElement>('[data-role="save-status"]');
      const restore = fastLongTimers(dom.window as unknown as { setTimeout: typeof setTimeout });
      try {
        click(dq('[data-action="reconnect"]')); // and nothing is ever sent back
        await waitFor(() => /did not answer/.test(status.textContent ?? ''));
      } finally {
        restore();
      }
      assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').disabled, false);
      assert.equal(dq<HTMLButtonElement>('[data-action="download"]').disabled, false);
      assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, false);
    },
  );

  /** Auto-lock runs off an idle clock that knows nothing about dialogs. A day
   * idle is past any delay, and coming back to the tab makes the page look. */
  async function autoLockNow(): Promise<void> {
    const realNow = Date.now;
    Date.now = () => realNow() + 24 * 3_600_000;
    try {
      doc.dispatchEvent(new dom.window.Event('visibilitychange'));
      await waitFor(() => q('#master-password') !== null);
    } finally {
      Date.now = realNow;
    }
  }

  async function unlockAgain(): Promise<void> {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    q('#unlock-form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
    await waitFor(() => q('#search-input') !== null);
  }

  const discardDlg = (selector: string): HTMLButtonElement =>
    dq<HTMLButtonElement>(`#dlg-confirm-discard ${selector}`);

  await t.test('a copy cannot be taken from a database that locked underneath', async () => {
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await autoLockNow(); // no reconnect in flight; the dialog is simply sitting open
    click(dq('[data-action="download"]'));
    await waitFor(() => /database locked/.test(status.textContent ?? ''));
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, true);
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, false);
  });

  await t.test('a database that auto-locks mid-reconnect is reported, not saved', async () => {
    click(dq('[data-role="save-later"]'));
    await unlockAgain();
    await reachExpiredSave();

    const status = dq<HTMLElement>('[data-role="save-status"]');
    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    await autoLockNow();

    const beforeReply = hostInbox.length;
    sendFromHost({ type: 'kw-reconnected', ok: true });
    await waitFor(() => /database locked/.test(status.textContent ?? ''));
    assert.ok(
      hostInbox.slice(beforeReply).every((sent) => sent.message.type !== 'kw-save'),
      'a locked database has nothing to save, so nothing was sent',
    );
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, false);
  });

  await t.test('a host that never answers the retried save unseals the dialog', async () => {
    click(dq('[data-role="save-later"]'));
    await unlockAgain();
    await reachExpiredSave();

    const status = dq<HTMLElement>('[data-role="save-status"]');
    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);

    /* The retry runs held, with every way out gone; without its own deadline a
    silent host would leave the edits sealed in here (#85). */
    const restore = fastLongTimers(dom.window as unknown as { setTimeout: typeof setTimeout });
    try {
      sendFromHost({ type: 'kw-reconnected', ok: true });
      await waitFor(() => /did not answer/.test(status.textContent ?? ''));
    } finally {
      restore();
    }
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, false);
    assert.equal(dq<HTMLButtonElement>('[data-action="save-host"]').hidden, false);
    click(dq('[data-role="save-later"]'));
  });

  await t.test('a discard prompt whose database locks stops offering to discard', async () => {
    // The previous test left the entry detail up; make an edit and leave it unsaved.
    click(q('[data-action="edit"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
    click(dq('[data-role="save-later"]'));

    sendFromHost({ type: 'kw-close-request' });
    await waitFor(() => dq<HTMLDialogElement>('#dlg-confirm-discard').open);
    const before = hostInbox.length;
    click(discardDlg('[data-action="confirm-save"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });
    const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() => /session with the storage provider expired/.test(status.textContent ?? ''));

    const beforeReconnect = hostInbox.length;
    click(discardDlg('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > beforeReconnect);
    await autoLockNow();
    sendFromHost({ type: 'kw-reconnected', ok: true });
    await waitFor(() => /database locked/.test(status.textContent ?? ''));

    /* The edits are in app.file behind the unlock screen; proceeding would tear
    the frame down and take them with it (#85). */
    assert.equal(discardDlg('[data-action="confirm-discard"]').hidden, true);
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, false);
  });

  await t.test('a save that cannot read the database reports rather than seals', async () => {
    click(discardDlg('[data-action="cancel-discard"]'));
    await unlockAgain();
    click(q('[data-action="add-entry"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
    click(dq('[data-role="save-later"]')); // still unsaved

    sendFromHost({ type: 'kw-close-request' });
    await waitFor(() => dq<HTMLDialogElement>('#dlg-confirm-discard').open);
    /* Locking after the prompt is already up leaves Save on screen over a
    database that is no longer there; this prompt holds through a save, so a
    throw on that path would trap the edits with no way out (#85). */
    await autoLockNow();

    const before = hostInbox.length;
    click(discardDlg('[data-action="confirm-save"]'));
    const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() => /could not prepare the database/.test(status.textContent ?? ''));
    assert.ok(
      hostInbox.slice(before).every((sent) => sent.message.type !== 'kw-save'),
      'nothing was sent, because nothing could be read',
    );
    assert.equal(discardDlg('[data-action="cancel-discard"]').hidden, false, 'the way out is back');
  });

  await t.test('a copy that cannot be prepared reports rather than seals', async () => {
    click(discardDlg('[data-action="cancel-discard"]'));
    await unlockAgain();
    await reachExpiredSave();

    const status = dq<HTMLElement>('[data-role="save-status"]');
    const realSave = Kdbx.prototype.save;
    Kdbx.prototype.save = (): Promise<Uint8Array> => {
      throw new Error('cannot serialize');
    };
    try {
      click(dq('[data-action="download"]'));
      await waitFor(() => /Could not prepare a copy/.test(status.textContent ?? ''));
    } finally {
      Kdbx.prototype.save = realSave;
    }
    // Still expired, so both ways forward are still on offer.
    assert.equal(dq<HTMLButtonElement>('[data-action="reconnect"]').hidden, false);
    assert.equal(dq<HTMLButtonElement>('[data-action="download"]').hidden, false);
    click(dq('[data-action="reconnect"]'));
    sendFromHost({ type: 'kw-reconnected', ok: false, error: 'nope' });
    await waitFor(() => /Reconnect failed/.test(status.textContent ?? ''));
    // Locking stops the idle clock (#84), which would otherwise hold this process open.
    await autoLockNow();
  });
});
