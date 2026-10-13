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
  deletePermanently,
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
  isRecycleBinEnabled,
  Kdbx,
  type KdbxCreateOptions,
  moveToGroup,
  pushHistorySnapshot,
  removeEntryAttachment,
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
/* A host answers every version check (#74). Tests that care set this; the rest
get "unchanged", as from a host whose file nobody else touched. Null leaves the
check unanswered, for a test to answer itself or not at all. */
let checkAnswer: Record<string, unknown> | null = { type: 'kw-checked', status: 'unchanged' };
const parentMock = {
  postMessage(message: Record<string, unknown>, origin: string): void {
    hostInbox.push({ message, origin });
    const answer = checkAnswer;
    if (message.type === 'kw-check' && answer !== null) setTimeout(() => sendFromHost(answer));
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
  isRecycleBinEnabled,
  getEntryTags,
  setEntryTags,
  getEntryTimes,
  setEntryExpiry,
  touchLastModified,
  moveToGroup,
  deletePermanently,
  getEntryAttachments,
  addEntryAttachment,
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

/** Answer the latest kw-save the way a host does, echoing its id (#91). */
function replyToSave(result: {
  ok: boolean;
  error?: string;
  reason?: string;
  version?: string;
}): void {
  const save = hostInbox.filter((sent) => sent.message.type === 'kw-save').at(-1);
  sendFromHost({ type: 'kw-saved', id: save?.message.id, ...result });
}

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
    sendFromHost({ type: 'kw-saved', id: 1, ok: true });
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
    /* A save in flight reports here, including an expired session that only this
    dialog can recover, so nothing dismisses it meanwhile (#85). */
    assert.equal(dq<HTMLButtonElement>('[data-role="save-later"]').hidden, true);

    replyToSave({ ok: true });
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
      replyToSave({ ok: false, error: 'HTTP 403' });
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
      replyToSave({ ok: false });
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
      replyToSave({ ok: true });
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
      replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });

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
    replyToSave({ ok: true });
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
    replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });
    const status = dq<HTMLElement>('[data-role="save-status"]');
    await waitFor(() => /session with the storage provider expired/.test(status.textContent ?? ''));

    const before = hostInbox.length;
    click(dq('[data-action="reconnect"]'));
    await waitFor(() => hostInbox.length > before);
    sendFromHost({ type: 'kw-reconnected', ok: true });
    await waitFor(() => hostInbox.at(-1)?.message.type === 'kw-save');
    replyToSave({ ok: false, error: 'HTTP 500' });

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
    replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });

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
    replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });

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

      replyToSave({ ok: true });
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

      replyToSave({ ok: true });
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

      replyToSave({ ok: false, error: 'HTTP 500' });
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
    replyToSave({ ok: false });
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
      replyToSave({ ok: true });
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

  // --- Saves that overlap (#91) ---------------------------------------------

  /** Add an entry from the entry list and open the save dialog for it. */
  async function addEntryAndOpenSaveDialog(): Promise<void> {
    click(q('[data-action="add-entry"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
  }

  async function startHostSave(button: Element): Promise<unknown> {
    const before = hostInbox.length;
    click(button);
    await waitFor(() => hostInbox.length > before);
    return lastHostMessage().id;
  }

  await t.test('each of two overlapping saves is settled by its own reply', async () => {
    await addEntryAndOpenSaveDialog();
    const saveStatus = dq<HTMLElement>('[data-role="save-status"]');
    const first = await startHostSave(dq('[data-action="save-host"]'));

    // The host asks to close while that save is out, and the prompt saves too.
    sendFromHost({ type: 'kw-close-request' });
    await waitFor(() => dq<HTMLDialogElement>('#dlg-confirm-discard').open);
    const second = await startHostSave(dq('#dlg-confirm-discard [data-action="confirm-save"]'));
    assert.notEqual(second, first);

    sendFromHost({ type: 'kw-saved', id: second, ok: false, error: 'HTTP 500' });
    const promptStatus = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() => promptStatus.textContent === 'Save failed: HTTP 500');
    assert.equal(saveStatus.textContent, 'Saving…', 'the first save is still out');

    sendFromHost({ type: 'kw-saved', id: first, ok: true });
    await waitFor(() => saveStatus.textContent === 'Saved.');
    assert.equal(promptStatus.textContent, 'Save failed: HTTP 500');

    click(dq('#dlg-confirm-discard [data-action="cancel-discard"]'));
    click(dq('[data-role="save-later"]'));
    click(q('[data-action="back"]')); // saving the entry left its detail screen up
  });

  await t.test('a reply to a save that gave up waiting is not taken for the retry', async () => {
    await addEntryAndOpenSaveDialog();
    const status = dq<HTMLElement>('[data-role="save-status"]');
    const before = hostInbox.length;
    click(dq('[data-action="save-host"]'));
    // Its wait starts once the bytes are ready, so shortening it here is in time.
    const restore = fastLongTimers(dom.window as unknown as { setTimeout: typeof setTimeout });
    try {
      await waitFor(() => /did not answer/.test(status.textContent ?? ''));
    } finally {
      restore();
    }
    const gaveUp = hostInbox.slice(before).find((sent) => sent.message.type === 'kw-save');
    assert.ok(gaveUp);

    const retry = await startHostSave(dq('[data-action="save-host"]'));
    sendFromHost({ type: 'kw-saved', id: gaveUp.message.id, ok: true });
    await settle();
    assert.equal(
      status.textContent,
      'Saving…',
      'the late success belongs to the save that gave up',
    );

    sendFromHost({ type: 'kw-saved', id: retry, ok: false, error: 'HTTP 500' });
    await waitFor(() => status.textContent === 'Save failed: HTTP 500');
    click(dq('[data-role="save-later"]'));
    click(q('[data-action="back"]'));
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
    replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });
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
    replyToSave({ ok: false, error: 'HTTP 401', reason: 'auth-expired' });
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

test('0x67 embedded in a host frame: a version saved elsewhere (#74)', async (t) => {
  const credentials = new Credentials({ password: PASSWORD });
  const base = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Shared Vault',
  });
  appendChild(base.getRootGroup(), createEntry({ title: 'Shared' }));
  const quiet = createEntry({ username: 'quiet' }); // untitled
  appendChild(base.getRootGroup(), quiet);
  const v1 = await base.save();
  const LATER = '2099-01-01T00:00:00Z'; // after anything this tab does

  /** Another workstation's copy of the opened file, with `change` saved later. */
  async function savedElsewhere(
    change: (db: Kdbx) => void,
    password = PASSWORD,
  ): Promise<ArrayBuffer> {
    const db = await Kdbx.load(v1, credentials);
    change(db);
    if (password !== PASSWORD) db.setCredentials(new Credentials({ password }));
    return new Uint8Array(await db.save()).buffer;
  }
  const addedThere = (title: string) => (db: Kdbx) =>
    appendChild(db.getRootGroup(), createEntry({ title }));
  const newer = (bytes: ArrayBuffer, version: string, savedAt?: string) => ({
    type: 'kw-checked',
    status: 'newer',
    bytes,
    version,
    ...(savedAt === undefined ? {} : { savedAt }),
  });
  const UNCHANGED = { type: 'kw-checked', status: 'unchanged' };

  const notice = (): HTMLDialogElement => dq<HTMLDialogElement>('#dlg-notice');
  const noticeText = (): string => dq<HTMLElement>('#notice-message').textContent ?? '';
  const noticeItems = (): string[] =>
    Array.from(doc.querySelectorAll('#notice-list li')).map((li) => li.textContent ?? '');
  const closeNotice = (): void => click(dq('#dlg-notice .dialog-footer [data-action="close"]'));
  const shows = (text: string): boolean => (root().textContent ?? '').includes(text);
  const lastSave = (): Record<string, unknown> =>
    hostInbox.filter((sent) => sent.message.type === 'kw-save').at(-1)?.message ?? {};
  const saveStatus = (): string => dq<HTMLElement>('[data-role="save-status"]').textContent ?? '';
  const saveDlg = (selector: string): HTMLButtonElement =>
    dq<HTMLButtonElement>(`#dlg-save ${selector}`);
  const promptDlg = (selector: string): HTMLButtonElement =>
    dq<HTMLButtonElement>(`#dlg-confirm-discard ${selector}`);

  function fastLongTimers(target: { setTimeout: typeof setTimeout }): () => void {
    const real = target.setTimeout;
    target.setTimeout = ((fn: () => void, ms?: number) =>
      real(fn, ms !== undefined && ms >= 1000 ? 0 : ms)) as typeof setTimeout;
    return () => {
      target.setTimeout = real;
    };
  }

  async function lockNow(): Promise<void> {
    const realNow = Date.now;
    Date.now = () => realNow() + 24 * 3_600_000;
    try {
      doc.dispatchEvent(new dom.window.Event('visibilitychange'));
      await waitFor(() => q('#master-password') !== null);
    } finally {
      Date.now = realNow;
    }
  }

  function submitUnlock(password = PASSWORD): void {
    q<HTMLInputElement>('#master-password').value = password;
    q('#unlock-form').dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
  }

  async function unlock(password = PASSWORD): Promise<void> {
    submitUnlock(password);
    await waitFor(() => q('#search-input') !== null);
  }

  async function unlockFails(password = PASSWORD): Promise<string> {
    const errorEl = q<HTMLElement>('#unlock-error');
    errorEl.hidden = true;
    submitUnlock(password);
    await waitFor(() => !errorEl.hidden);
    return errorEl.textContent ?? '';
  }

  // An unsaved edit: a new entry, saved into the database but not back to the host.
  async function editUnsaved(): Promise<void> {
    if (!q('[data-action="add-entry"]')) click(q('[data-action="back"]'));
    click(q('[data-action="add-entry"]'));
    await waitFor(() => q('[data-action="save"]') !== null);
    click(q('[data-action="save"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
    click(saveDlg('[data-role="save-later"]'));
  }

  async function saveToHost(): Promise<void> {
    if (!q('[data-action="save-database"]')) click(q('[data-action="back"]'));
    click(q('[data-action="save-database"]'));
    await waitFor(() => dq<HTMLDialogElement>('#dlg-save').open);
    const before = hostInbox.length;
    click(saveDlg('[data-action="save-host"]'));
    await waitFor(() => hostInbox.slice(before).some((sent) => sent.message.type === 'kw-save'));
  }

  async function saveCleanly(version: string): Promise<void> {
    await saveToHost();
    replyToSave({ ok: true, version });
    await waitFor(() => saveStatus() === 'Saved.');
    click(saveDlg('[data-role="save-later"]'));
  }

  await t.test(
    'an open names its version, and a save builds on it and learns the next',
    async () => {
      dq<HTMLDialogElement>('#dlg-save').close(); // left held by the previous walkthrough
      sendFromHost({
        type: 'kw-open',
        filename: 'shared.kdbx',
        bytes: new Uint8Array(v1).buffer,
        version: 'rev-1',
      });
      await waitFor(() => q('#master-password') !== null);
      const before = hostInbox.length;
      await unlock();
      assert.ok(
        hostInbox.slice(before).every((sent) => sent.message.type !== 'kw-check'),
        'nothing to check right after opening',
      );

      await editUnsaved();
      await saveToHost();
      assert.equal(lastSave().base, 'rev-1');
      replyToSave({ ok: true, version: 'rev-2' });
      await waitFor(() => saveStatus() === 'Saved.');
      click(saveDlg('[data-role="save-later"]'));
      await editUnsaved();
      await saveToHost();
      assert.equal(lastSave().base, 'rev-2', 'the next save builds on what the last one stored');
      replyToSave({ ok: true });
      await waitFor(() => saveStatus() === 'Saved.');
      click(saveDlg('[data-role="save-later"]'));
    },
  );

  await t.test(
    'unlocking after a lock asks for a newer version, and carries on without one',
    async () => {
      await lockNow();
      const before = hostInbox.length;
      await unlock();
      assert.deepEqual(
        hostInbox.slice(before).find((sent) => sent.message.type === 'kw-check')?.message,
        { type: 'kw-check', base: 'rev-2' },
      );
      assert.equal(notice().open, false);
    },
  );

  await t.test('with nothing unsaved, a newer version opens in place of this one', async () => {
    checkAnswer = newer(await savedElsewhere(addedThere('Added there')), 'rev-3', LATER);
    await lockNow();
    await unlock();
    assert.ok(shows('Added there'));
    assert.equal(notice().open, true);
    assert.equal(dq('#notice-title').textContent, 'Opened the newer version');
    assert.match(noticeText(), /saved elsewhere at .+, so that version is open now/);
    closeNotice();
    checkAnswer = UNCHANGED;
    await editUnsaved();
    await saveCleanly('rev-4');
    assert.equal(
      hostInbox.filter((sent) => sent.message.type === 'kw-save').at(-1)?.message.base,
      'rev-3',
    );
  });

  await t.test(
    'a newer version these credentials cannot open keeps the unlock screen up',
    async () => {
      checkAnswer = newer(await savedElsewhere(() => {}, 'another password'), 'rev-5');
      await lockNow();
      assert.equal(
        await unlockFails(),
        "The version saved elsewhere doesn't open with these credentials.",
      );
      checkAnswer = UNCHANGED;
      await unlock();
    },
  );

  await t.test('with unsaved edits, a newer version is merged in and left to review', async () => {
    await editUnsaved();
    const there = await savedElsewhere((db) => {
      appendChild(db.getRootGroup(), createEntry({ title: 'Merged in' }));
      appendChild(db.getRootGroup(), createEntry({ title: 'Also merged in' }));
      // Changed there with no History snapshot, so this copy's version is new to it: a conflict.
      const entry = getChildren(db.getRootGroup(), 'Entry').find(
        (e) =>
          getText(getChild(e, 'UUID') as XmlElement) ===
          getText(getChild(quiet, 'UUID') as XmlElement),
      ) as XmlElement;
      const userName = getChildren(entry, 'String')[1] as XmlElement;
      setText(getChild(userName, 'Value') as XmlElement, 'changed there');
      const times = getChild(entry, 'Times') as XmlElement;
      setText(getChild(times, 'LastModificationTime') as XmlElement, LATER);
    });
    checkAnswer = newer(there, 'rev-6', LATER);
    await lockNow();
    await unlock();
    assert.ok(shows('Merged in') && shows('Also merged in'));
    assert.equal(dq('#notice-title').textContent, 'Merged with the version saved elsewhere');
    assert.match(noticeText(), /\d+ changes from there are now merged with your unsaved changes/);
    assert.deepEqual(noticeItems(), ['(untitled)']);
    closeNotice();
    assert.equal(q<HTMLButtonElement>('[data-action="save-database"]').disabled, false, 'unsaved');
    checkAnswer = UNCHANGED;
    await saveCleanly('rev-7');
    assert.equal(
      hostInbox.filter((sent) => sent.message.type === 'kw-save').at(-1)?.message.base,
      'rev-6',
    );
  });

  await t.test(
    'a password changed elsewhere is named, and merging waits for the old one',
    async () => {
      await editUnsaved();
      checkAnswer = newer(
        await savedElsewhere(addedThere('Behind a new key'), 'new password'),
        'rev-8',
      );
      await lockNow();
      assert.match(
        await unlockFails('new password'),
        /These credentials open the version saved elsewhere, but your unsaved changes here are locked with the previous ones/,
      );
      assert.match(await unlockFails('neither'), /./, 'a wrong password is still just wrong');

      await unlock(); // the previous password opens this copy, but not the newer one
      assert.equal(dq('#notice-title').textContent, 'Could not merge');
      assert.ok(!shows('Behind a new key'));
      closeNotice();
      checkAnswer = UNCHANGED;
      await saveToHost();
      assert.equal(lastSave().base, 'rev-7', 'still built on what it had, so a save is refused');
      replyToSave({ ok: true, version: 'rev-9' });
      await waitFor(() => saveStatus() === 'Saved.');
      click(saveDlg('[data-role="save-later"]'));
    },
  );

  await t.test('a file gone from storage still unlocks, with a warning', async () => {
    checkAnswer = { type: 'kw-checked', status: 'gone' };
    await lockNow();
    await unlock();
    assert.equal(dq('#notice-title').textContent, 'This file is gone from storage');
    closeNotice();
    checkAnswer = UNCHANGED;
  });

  await t.test('a host that never answers the check lets the unlock go ahead', async () => {
    checkAnswer = null;
    await lockNow();
    const restore = fastLongTimers(dom.window as unknown as { setTimeout: typeof setTimeout });
    try {
      await unlock();
    } finally {
      restore();
    }
    assert.equal(notice().open, false);
    checkAnswer = UNCHANGED;
  });

  // --- A save refused because of a version saved elsewhere --------------------

  async function reachConflict(): Promise<void> {
    await editUnsaved();
    await saveToHost();
    replyToSave({ ok: false, error: 'it was saved elsewhere since', reason: 'conflict' });
    await waitFor(() => /stored file changed since it was opened here/.test(saveStatus()));
  }

  await t.test(
    'a refused save offers Merge or a copy, and holds the dialog until one is taken',
    async () => {
      await reachConflict();
      assert.equal(saveDlg('[data-action="merge"]').hidden, false);
      assert.equal(saveDlg('[data-action="download"]').hidden, false);
      assert.equal(saveDlg('[data-action="download"]').textContent, 'Download a copy');
      assert.equal(saveDlg('[data-action="save-host"]').hidden, true);
      assert.equal(
        saveDlg('[data-role="save-later"]').hidden,
        true,
        'held: the edits are only here',
      );

      click(saveDlg('[data-action="download"]'));
      await waitFor(() => /Copy downloaded\. Merge to save back/.test(saveStatus()));
      assert.equal(saveDlg('[data-role="save-later"]').hidden, false, 'a copy lets it go');
      assert.equal(saveDlg('[data-action="merge"]').hidden, false);
    },
  );

  await t.test('a merge that finds nothing newer, or no file, or no answer, says so', async () => {
    checkAnswer = UNCHANGED;
    click(saveDlg('[data-action="merge"]'));
    await waitFor(() => saveStatus() === 'Nothing newer is stored now, so save again.');
    assert.equal(saveDlg('[data-action="save-host"]').hidden, false);

    for (const [status, expected] of [
      ['gone', /removed or replaced in storage/],
      ['unknown', /Could not fetch the version saved elsewhere/],
    ] as const) {
      const before = hostInbox.length;
      click(saveDlg('[data-action="save-host"]'));
      await waitFor(() => hostInbox.slice(before).some((sent) => sent.message.type === 'kw-save'));
      replyToSave({ ok: false, error: 'it was saved elsewhere since', reason: 'conflict' });
      await waitFor(() => /stored file changed since it was opened here/.test(saveStatus()));
      checkAnswer = { type: 'kw-checked', status };
      click(saveDlg('[data-action="merge"]'));
      await waitFor(() => expected.test(saveStatus()));
      assert.equal(saveDlg('[data-action="merge"]').hidden, false, 'still on offer');
    }
  });

  await t.test(
    'a newer version that will not open is not merged, and a copy stays on offer',
    async () => {
      checkAnswer = newer(await savedElsewhere(() => {}, 'another password'), 'rev-10');
      click(saveDlg('[data-action="merge"]'));
      await waitFor(() =>
        /couldn't be opened or read with this database's credentials/.test(saveStatus()),
      );
      assert.equal(saveDlg('[data-action="download"]').hidden, false);

      const realSave = Kdbx.prototype.save;
      Kdbx.prototype.save = (): Promise<Uint8Array> => {
        throw new Error('cannot serialize');
      };
      try {
        click(saveDlg('[data-action="download"]'));
        await waitFor(() => /Could not prepare a copy/.test(saveStatus()));
      } finally {
        Kdbx.prototype.save = realSave;
      }
      assert.equal(saveDlg('[data-role="save-later"]').hidden, true, 'still held');
    },
  );

  await t.test('a merge waits on the host, and a lock meanwhile is reported', async () => {
    checkAnswer = null;
    const before = hostInbox.length;
    click(saveDlg('[data-action="merge"]'));
    await waitFor(() => hostInbox.slice(before).some((sent) => sent.message.type === 'kw-check'));
    assert.equal(saveDlg('[data-action="merge"]').disabled, true);
    assert.equal(saveDlg('[data-action="download"]').disabled, true);
    await lockNow();
    sendFromHost(UNCHANGED);
    await waitFor(() => /database locked/.test(saveStatus()));
    checkAnswer = UNCHANGED;
    click(saveDlg('[data-role="save-later"]'));
    await unlock();
  });

  await t.test(
    'an unlock while a merge waits supersedes its check, not holding the dialog',
    async () => {
      await reachConflict();
      checkAnswer = null;
      const before = hostInbox.length;
      click(saveDlg('[data-action="merge"]'));
      await waitFor(() => hostInbox.slice(before).some((sent) => sent.message.type === 'kw-check'));
      await lockNow();
      checkAnswer = UNCHANGED;
      await unlock(); // its own check replaces the merge's, which the host never answered
      await waitFor(() => /database locked/.test(saveStatus()));
      assert.equal(saveDlg('[data-role="save-later"]').hidden, false, 'released at once');
      click(saveDlg('[data-role="save-later"]'));
    },
  );

  await t.test(
    'a merge brings the newer version in, closes the dialog and shows what came',
    async () => {
      await reachConflict();
      checkAnswer = newer(await savedElsewhere(addedThere('One more')), 'rev-11', LATER);
      click(saveDlg('[data-action="merge"]'));
      await waitFor(() => notice().open);
      assert.equal(dq<HTMLDialogElement>('#dlg-save').open, false);
      assert.match(noticeText(), /1 change from there is now merged/);
      assert.ok(shows('One more'));
      closeNotice();
      checkAnswer = UNCHANGED;
      await saveCleanly('rev-12');
      assert.equal(
        hostInbox.filter((sent) => sent.message.type === 'kw-save').at(-1)?.message.base,
        'rev-11',
      );
    },
  );

  await t.test('the close prompt offers the same merge, and does not close after it', async () => {
    await editUnsaved();
    sendFromHost({ type: 'kw-close-request' });
    await waitFor(() => dq<HTMLDialogElement>('#dlg-confirm-discard').open);
    let before = hostInbox.length;
    click(promptDlg('[data-action="confirm-save"]'));
    await waitFor(() => hostInbox.slice(before).some((sent) => sent.message.type === 'kw-save'));
    const own = lastSave().bytes as ArrayBuffer;
    replyToSave({ ok: false, error: 'it was saved elsewhere since', reason: 'conflict' });
    const status = dq<HTMLElement>('[data-role="confirm-discard-status"]');
    await waitFor(() =>
      /stored file changed since it was opened here/.test(status.textContent ?? ''),
    );
    assert.equal(promptDlg('[data-action="confirm-discard"]').hidden, true);
    assert.equal(promptDlg('[data-action="cancel-discard"]').hidden, true);

    click(promptDlg('[data-action="download"]'));
    await waitFor(() => /Copy downloaded\. Merge to save back/.test(status.textContent ?? ''));

    // The newer version is this tab's own save, so nothing new comes in.
    checkAnswer = newer(own, 'rev-13');
    before = hostInbox.length;
    click(promptDlg('[data-action="merge"]'));
    await waitFor(() => notice().open);
    assert.equal(dq<HTMLDialogElement>('#dlg-confirm-discard').open, false);
    assert.match(noticeText(), /with nothing your copy here lacked/);
    assert.ok(
      hostInbox.slice(before).every((sent) => sent.message.type !== 'kw-close'),
      'merging is not consent to close',
    );
    closeNotice();
    checkAnswer = UNCHANGED;
    await saveCleanly('rev-14');
    // Locking stops the idle clock, which would otherwise hold this process open.
    await lockNow();
  });
});
