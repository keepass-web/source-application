/**
 * Behavioral tests for 0x67/page.ts, the one file in this workspace that
 * touches real DOM APIs at module scope (see its "Boot" section). Plain Node
 * has no DOM, so pages/tests/coverage.test.ts deliberately lets a bare import
 * of it throw — that's the honest signal that it had no test coverage at all.
 *
 * This file gives it real coverage instead, using jsdom (a devDependency
 * scoped to this workspace) to provide a `document`/`navigator`. page.ts is a
 * global script with zero exports — its functions are private, driven only
 * by DOM events, exactly like a browser would drive them — so these tests
 * exercise it exclusively through the real page.html markup and dispatched
 * events, not by importing its internals directly.
 *
 * Three real, upstream gaps this file works around rather than pretends
 * don't exist: jsdom does not implement HTMLDialogElement's
 * showModal()/close() (tracked upstream:
 * https://github.com/jsdom/jsdom/issues/3294, still open as of the jsdom
 * version pinned here), the Clipboard API, or pointer capture. All three are
 * given minimal, behavior-only polyfills below — open/close state, a
 * writable clipboard buffer, and no-op capture — nothing about real
 * focus-trapping, OS clipboard access or pointer routing, none of which
 * page.ts relies on.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { peerOrigin } from '../../packages/embed-protocol/src/index.ts';
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
  findPreviousParentGroup,
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
  moveToGroup,
  pushHistorySnapshot,
  removeEntryAttachment,
  restoreHistoryEntry,
  setAttribute,
  setEntryExpiry,
  setEntryTags,
  setText,
  touchLastModified,
  type XmlElement,
} from '../../packages/kdbx/src/index.ts';
import type { generatePassword } from '../0x67/logic.ts';
import * as logic from '../0x67/logic.ts';
import { applyTabState } from '../shared/logic.ts';

// ============================================================
// jsdom environment, built from the real page.html
// ============================================================
//
// page.ts calls showUpload() at module scope, so the DOM must already have
// the real markup (templates, dialogs, #root) in place *before* it's
// imported below — that's why all of this setup runs at module scope too,
// ahead of the dynamic import at the bottom of this section.

const htmlPath = fileURLToPath(new URL('../0x67/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });

// Node itself ships a getter-only global `navigator` (and `document` may be
// non-configurable too, depending on Node version), so plain assignment can
// fail — define both as plain, writable/configurable own properties instead.
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
// page.ts reads window.location / window.parent at module scope for its
// optional host integration. A top-level jsdom window is its own parent, so
// isEmbedded() is false here and the host path stays dormant — exactly the
// standalone behavior this file exercises. The embedded path is covered
// separately in 0x67-host.test.ts.
Object.defineProperty(globalThis, 'window', {
  value: dom.window as unknown as Window & typeof globalThis,
  configurable: true,
  writable: true,
});

// downloadDatabase() clicks a real <a href="blob:..."> to trigger a browser
// download. jsdom doesn't implement navigation and reports an async
// "Not implemented: navigation to another Document" jsdomError some time
// after the click — harmless (the download flow doesn't depend on
// navigation actually happening), but it fires on a delay that can land
// inside an unrelated, later test's own console/error assertions. Stop it
// at the source: prevent the default action on any real anchor click.
dom.window.document.addEventListener(
  'click',
  (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('a[href]')) e.preventDefault();
  },
  true,
);

// --- HTMLDialogElement polyfill (see file header) ---
dom.window.HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new dom.window.Event('close'));
};

// --- Clipboard polyfill (see file header) ---
let clipboardText = '';
let clipboardWritesShouldFail = false;
interface HeldWrite {
  text: string;
  settle(accepted: boolean): void;
}
// When set, each write waits here for the test to settle it, so writes can be held in flight.
let heldWrites: HeldWrite[] | null = null;
(
  dom.window.navigator as unknown as { clipboard: { writeText(text: string): Promise<void> } }
).clipboard = {
  async writeText(text: string): Promise<void> {
    const held = heldWrites;
    if (held) {
      return new Promise((resolve, reject) => {
        held.push({
          text,
          settle(accepted) {
            if (!accepted) return reject(new Error('simulated refusal'));
            clipboardText = text;
            resolve();
          },
        });
      });
    }
    if (clipboardWritesShouldFail) throw new Error('simulated clipboard failure');
    clipboardText = text;
  },
};

// --- Pointer capture polyfill (see file header) ---
dom.window.HTMLElement.prototype.setPointerCapture = () => {};
dom.window.HTMLElement.prototype.releasePointerCapture = () => {};

// --- Hoist the kdbx library and this page's own pure logic onto globalThis,
// --- exactly like bundle.js does in the real browser build (see
// --- bundle-iife.json's "exports" list, which this mirrors exactly). ---
Object.assign(globalThis, {
  applyTabState,
  peerOrigin,
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
  findPreviousParentGroup,
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
  ...logic,
});

// Every sprite icon the app draws across the whole file, recorded from before
// page.ts boots, so the last test can check each against the sprite (#121).
const drawnIcons = new Set<string>();
function recordIcons(node: Node): void {
  if (!(node instanceof dom.window.Element || node instanceof dom.window.DocumentFragment)) return;
  for (const use of node.querySelectorAll('use')) drawnIcons.add(use.getAttribute('href') ?? '');
}
new dom.window.MutationObserver((records) => {
  for (const record of records) record.addedNodes.forEach(recordIcons);
}).observe(dom.window.document, { childList: true, subtree: true });

await import('../0x67/page.ts');

// ============================================================
// Test helpers
// ============================================================

// The sprite symbol an element draws (#121).
const iconOf = (el: Element): string | null | undefined =>
  el.querySelector('use')?.getAttribute('href');

const root = (): HTMLElement => dom.window.document.getElementById('root') as HTMLElement;
// Scoped to #root: the currently-active screen (upload/unlock/entry-list/
// entry-detail/entry-edit), which is the only part of the page swapped in
// and out via setRoot().
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;
// Scoped to the whole document: the four <dialog>s are static body markup,
// siblings of #root, not inside it — used for anything inside a dialog.
const dq = <T extends Element = Element>(selector: string): T =>
  dom.window.document.querySelector<T>(selector) as T;
const byId = <T extends Element = Element>(id: string): T =>
  dom.window.document.getElementById(id) as unknown as T;

/** Poll a real Node timer (never mocked in this file except inside its own
 * narrowly-scoped subtests) until `predicate` is true, for async work
 * (Argon2 KDF, crypto, File#arrayBuffer) whose completion can't be awaited
 * directly through the DOM event dispatch that triggers it. */
async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function dispatch(el: EventTarget, type: string, extra?: Record<string, unknown>): Event {
  const evt = new dom.window.Event(type, { bubbles: true, cancelable: true });
  if (extra) Object.assign(evt, extra);
  el.dispatchEvent(evt);
  return evt;
}

function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

// Fast KDF settings so the suite runs quickly — same rationale and values as
// packages/kdbx/tests/kdbx.test.ts.
const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;
const PASSWORD = 'unit-test-password';
const KEYFILE = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

async function buildTestDatabase(): Promise<Uint8Array> {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Personal Vault',
  });
  const rootGroup = kdbx.getRootGroup();
  appendChild(
    rootGroup,
    createEntry({
      title: 'GitHub',
      username: 'octocat',
      password: 'hunter2',
      url: 'https://github.com',
    }),
  );
  appendChild(
    rootGroup,
    createEntry({ title: 'Second Entry', username: 'user2', password: 'pw2' }),
  );
  // No username at all: entryField('UserName') is '', exercising the "fall
  // back to ''" branch of buildEntryRow's `username || url || ''`. Its IconID
  // is past KeePass's standard set, as a newer app might write (#121).
  const noContactEntry = createEntry({ title: 'No Contact Info' });
  setText(getChild(noContactEntry, 'IconID') as XmlElement, '99');
  appendChild(rootGroup, noContactEntry);
  // No username but a URL: exercises the middle `|| url` branch instead.
  // Also carries one hand-built, deliberately malformed <String> (a Key with
  // no matching Value) — createEntry() itself always produces complete
  // Key/Value pairs, so this is the only way to exercise showEntryDetail's
  // and showEntryEdit's defensive "skip an incomplete field" branch through
  // a real, persisted, round-tripped entry rather than a contrived direct call.
  const urlOnlyEntry = createEntry({ title: 'URL Only', url: 'https://example.org' });
  const malformedField = createElement('String');
  appendChild(malformedField, createElement('Key', 'Malformed'));
  appendChild(urlOnlyEntry, malformedField);
  appendChild(rootGroup, urlOnlyEntry);

  const sub = createGroup('Work');
  appendChild(rootGroup, sub);
  appendChild(
    sub,
    createEntry({ title: 'Nested Entry', username: 'nested-user', password: 'nested-pw' }),
  );
  return kdbx.save();
}

const dbBytes = await buildTestDatabase();

function makeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name);
}

// ============================================================
// The walkthrough
// ============================================================
//
// One continuous, ordered narrative rather than independent tests: page.ts
// is a real stateful singleton app (module-level `app` object), loaded once,
// so later steps deliberately build on the DOM/app state earlier steps left
// behind — the same way a real user session would.

test('0x67 app', async (t) => {
  await t.test('boots to the upload screen', () => {
    assert.ok(q('#drop-zone'));
    assert.ok(q('#file-input'));
    assert.equal(dom.window.document.body.classList.contains('app-mode'), false);
    assert.equal(dom.window.document.body.classList.contains('embedded'), false);
    assert.equal(dom.window.document.title, 'KeePass Web');
  });

  await t.test('dragover/dragleave toggle the drag-over class', () => {
    const dropZone = q('#drop-zone');
    const over = dispatch(dropZone, 'dragover');
    assert.equal(over.defaultPrevented, true);
    assert.equal(dropZone.classList.contains('drag-over'), true);

    dispatch(dropZone, 'dragleave');
    assert.equal(dropZone.classList.contains('drag-over'), false);
  });

  await t.test('dropping a file moves to the unlock screen', async () => {
    const dropZone = q('#drop-zone');
    const file = makeFile('dropped.kdbx', new Uint8Array([1, 2, 3]));
    const evt = dispatch(dropZone, 'drop', { dataTransfer: { files: [file] } });
    assert.equal(evt.defaultPrevented, true);
    assert.equal(dropZone.classList.contains('drag-over'), false);

    await waitFor(() => q('#master-password') !== null);
    assert.equal(q<HTMLElement>('#db-filename').textContent, 'dropped.kdbx');
    assert.equal(dom.window.document.title, 'dropped.kdbx - Locked - KeePass Web');
  });

  await t.test('unlock screen "back" returns to upload and clears the file', () => {
    q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.ok(q('#drop-zone'));
    assert.equal(dom.window.document.title, 'KeePass Web');
  });

  await t.test(
    'creating a new database: validation, then landing in an empty entry list',
    async () => {
      q('[data-action="create-database"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.ok(q('#create-form'));

      // Back returns to upload without creating anything.
      q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.ok(q('#drop-zone'));
      q('[data-action="create-database"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      // No password at all.
      dispatch(q('#create-form'), 'submit');
      assert.equal(q<HTMLElement>('#create-error').hidden, false);
      assert.match(q<HTMLElement>('#create-error').textContent ?? '', /master password/i);

      // Passwords that don't match each other.
      q<HTMLInputElement>('#create-password').value = 'new-db-password';
      q<HTMLInputElement>('#create-password-confirm').value = 'does-not-match';
      dispatch(q('#create-form'), 'submit');
      assert.equal(q<HTMLElement>('#create-error').hidden, false);
      assert.match(q<HTMLElement>('#create-error').textContent ?? '', /do not match/i);

      q<HTMLInputElement>('#create-name').value = 'Fresh Vault';
      q<HTMLInputElement>('#create-password-confirm').value = 'new-db-password';

      const createKeyfileInput = q<HTMLInputElement>('#create-keyfile-input');
      setFiles(createKeyfileInput, [makeFile('create-keyfile.bin', KEYFILE)]);
      dispatch(createKeyfileInput, 'change');
      await waitFor(
        () => q<HTMLElement>('#create-keyfile-label').textContent === 'create-keyfile.bin',
      );

      dispatch(q('#create-form'), 'submit');

      await waitFor(() => dom.window.document.body.classList.contains('app-mode'), 15000);
      assert.equal(q<HTMLElement>('#panel-title').textContent, 'Fresh Vault');
      assert.equal(root().querySelectorAll('.entry-row').length, 0);
      assert.equal(q('#group-tree').querySelectorAll('.group-btn').length, 1);

      // Reset back to the upload screen for the rest of the walkthrough.
      // Closing a freshly-created (unsaved) database needs confirmation.
      q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.ok(q('#drop-zone'));
    },
  );

  await t.test('choosing a file via the file input also reaches the unlock screen', async () => {
    const fileInput = q<HTMLInputElement>('#file-input');
    setFiles(fileInput, [makeFile('real.kdbx', dbBytes)]);
    dispatch(fileInput, 'change');

    await waitFor(() => q('#master-password') !== null);
    assert.equal(q<HTMLElement>('#db-filename').textContent, 'real.kdbx');
  });

  await t.test(
    'a wrong password is rejected with a visible error, and the form resets',
    async () => {
      const passwordInput = q<HTMLInputElement>('#master-password');
      passwordInput.value = 'not the right password';
      const btn = q<HTMLButtonElement>('#unlock-btn');

      dispatch(q('#unlock-form'), 'submit');
      await waitFor(() => q<HTMLButtonElement>('#unlock-btn').disabled === false);

      const errorEl = q<HTMLElement>('#unlock-error');
      assert.equal(errorEl.hidden, false);
      assert.ok(errorEl.textContent && errorEl.textContent.length > 0);
      assert.equal(btn.textContent, 'Unlock');
    },
  );

  await t.test('the key file input updates its label', async () => {
    const keyfileInput = q<HTMLInputElement>('#keyfile-input');
    setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
    dispatch(keyfileInput, 'change');
    await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  });

  await t.test('the master password field can be revealed and hidden again', () => {
    const passwordInput = q<HTMLInputElement>('#master-password');
    const toggle = q('[data-action="toggle-password"]');
    assert.equal(passwordInput.type, 'password');
    assert.equal(iconOf(toggle), '#icon-eye');
    toggle.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(passwordInput.type, 'text');
    assert.equal(iconOf(toggle), '#icon-eye-off', 'a revealed field offers to hide it (#121)');
    toggle.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(passwordInput.type, 'password');
    assert.equal(iconOf(toggle), '#icon-eye');
  });

  // jsdom never moves focus on a press, so the observable here is that the
  // handler cancels it; e2e/reveal-focus.test.ts proves the real outcome.
  await t.test('revealing the master password does not steal the caret', () => {
    assert.ok(
      dispatch(q('[data-action="toggle-password"]'), 'mousedown').defaultPrevented,
      'the press that would move focus to the button is suppressed',
    );
  });

  // With the caret somewhere else entirely, the reveal brings it to the field,
  // since typing is what comes next (#110).
  await t.test('revealing the master password puts the caret in the field', () => {
    const passwordInput = q<HTMLInputElement>('#master-password');
    passwordInput.blur();
    assert.notEqual(dom.window.document.activeElement, passwordInput);

    const toggle = q('[data-action="toggle-password"]');
    dispatch(toggle, 'click');
    assert.equal(passwordInput.type, 'text');
    assert.equal(dom.window.document.activeElement, passwordInput);

    dispatch(toggle, 'click'); // hidden again, as the rest of the suite expects
  });

  await t.test('the correct password and key file unlock into the entry list', async () => {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    dispatch(q('#unlock-form'), 'submit');

    await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
    assert.ok(q('#group-tree').querySelector('.group-btn'));
    assert.equal(dom.window.document.title, 'real.kdbx - Unlocked - KeePass Web');
    // Table view is the default.
    assert.equal(root().querySelectorAll('.entry-table').length, 1);
    // Switch to tile view, which the rest of this suite's entry-list
    // assertions are written against.
    dispatch(q('[data-action="view-tile"]'), 'click');
    // Root group is selected by default: four entries at the root.
    assert.equal(root().querySelectorAll('.entry-row').length, 4);
  });

  await t.test(
    'entry rows fall back through username/URL/blank meta text, and malformed fields are skipped',
    () => {
      // The icon is drawn, not text, so a row title is exactly the entry's title (#121).
      const rowFor = (title: string): HTMLElement =>
        Array.from(root().querySelectorAll('.entry-row')).find(
          (r) => r.querySelector('.entry-row-title')?.textContent === title,
        ) as HTMLElement;

      // Has a username: meta shows it (already covered by every other row
      // in this fixture — asserted here too for a clear three-way contrast).
      assert.equal(rowFor('GitHub').querySelector('.entry-row-meta')?.textContent, 'octocat');
      assert.equal(iconOf(rowFor('GitHub')), '#icon-key');
      // No username, no URL: falls all the way back to ''.
      assert.equal(rowFor('No Contact Info').querySelector('.entry-row-meta')?.textContent, '');
      // An IconID past KeePass's standard set still draws something (#121).
      assert.equal(iconOf(rowFor('No Contact Info')), '#icon-unknown');
      // No username, but a URL: falls back to the URL specifically.
      assert.equal(
        rowFor('URL Only').querySelector('.entry-row-meta')?.textContent,
        'https://example.org',
      );

      // The malformed field on "URL Only" (a Key with no Value) must not
      // appear in either the detail or edit screen — both skip incomplete
      // fields rather than rendering them.
      rowFor('URL Only').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const detailLabels = Array.from(root().querySelectorAll('.detail-label')).map(
        (el) => el.textContent,
      );
      assert.deepEqual(detailLabels, ['Title', 'UserName', 'Password', 'URL', 'Notes']);

      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const editKeys = Array.from(root().querySelectorAll<HTMLInputElement>('.edit-key')).map(
        (el) => el.value,
      );
      assert.deepEqual(editKeys, ['Title', 'UserName', 'Password', 'URL', 'Notes']);

      // Cancelling an existing (not new) entry's edit returns to its detail
      // screen, not the list — back out the rest of the way too, so the
      // walkthrough continues from the entry list as the next step expects.
      q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    },
  );

  await t.test(
    'the group tree renders the nested "Work" subgroup, and switching to it works',
    () => {
      const buttons = Array.from(
        q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'),
      );
      const rootBtn = buttons.find(
        (b) => b.textContent === 'real.kdbx' || b.classList.contains('active'),
      );
      assert.ok(rootBtn, 'root group button should be marked active by default');

      const workBtn = buttons.find((b) => b.textContent?.includes('Work'));
      assert.ok(workBtn, 'Work subgroup button should be rendered under the root');
      workBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

      assert.equal(q<HTMLElement>('#panel-title').textContent, 'Work');
      assert.equal(root().querySelectorAll('.entry-row').length, 1);
    },
  );

  await t.test('searching filters entries and clears when switching groups', () => {
    const searchInput = q<HTMLInputElement>('#search-input');
    searchInput.value = 'octocat';
    dispatch(searchInput, 'input');
    assert.equal(q<HTMLElement>('#panel-title').textContent, '"octocat"');
    assert.equal(root().querySelectorAll('.entry-row').length, 1);

    searchInput.value = 'no such entry anywhere';
    dispatch(searchInput, 'input');
    assert.equal(root().querySelector('.entry-empty')?.textContent, 'No matches.');

    // Switching groups resets the search box and query.
    const rootGroupBtn = Array.from(
      q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'),
    )[0];
    rootGroupBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(q<HTMLInputElement>('#search-input').value, '');
    assert.equal(root().querySelectorAll('.entry-row').length, 4);
  });

  await t.test('search results across groups show the group path', () => {
    const searchInput = q<HTMLInputElement>('#search-input');
    searchInput.value = 'nested';
    dispatch(searchInput, 'input');
    const path = root().querySelector('.entry-row-path');
    assert.ok(path, 'a cross-group search result should show its group path');
    assert.equal(path?.textContent, 'Personal Vault › Work');

    searchInput.value = '';
    dispatch(searchInput, 'input');
  });

  await t.test('adding a new group: empty name is rejected, then a real name creates it', () => {
    q('[data-action="add-group"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const dlg = byId<HTMLDialogElement>('dlg-new-group');
    assert.equal(dlg.open, true);
    assert.equal(byId<HTMLInputElement>('new-group-name').value, '');

    dq('#dlg-new-group [data-action="create-group"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, true, 'an empty name must not close the dialog');

    // Pick a non-default icon before naming and creating the group.
    const groupIconBtn = byId<HTMLButtonElement>('new-group-icon-btn');
    assert.equal(iconOf(groupIconBtn), '#icon-folder', "defaults to KeePass's Folder icon");
    groupIconBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLDialogElement>('dlg-icon-picker').open, true);
    const options = Array.from(
      byId<HTMLElement>('icon-grid').querySelectorAll<HTMLButtonElement>('.icon-grid-btn'),
    );
    assert.equal(options.length, 69, "the picker offers all of KeePass's standard icons (#121)");
    const webIconOption = options[1] as HTMLButtonElement;
    assert.equal(webIconOption.title, 'Web', 'in IconID order');
    webIconOption.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLDialogElement>('dlg-icon-picker').open, false);
    assert.equal(iconOf(groupIconBtn), '#icon-web');

    const nameInput = byId<HTMLInputElement>('new-group-name');
    nameInput.value = 'Personal';
    // Exercise the Enter-to-submit path specifically (distinct from clicking
    // the Create button directly).
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    nameInput.dispatchEvent(enter);

    assert.equal(dlg.open, false);
    assert.equal(q<HTMLElement>('#panel-title').textContent, 'Personal');
    assert.equal(root().querySelector('.entry-empty')?.textContent, 'No entries in this group.');
    const activeGroup = q('#group-tree').querySelector('.group-btn.active') as Element;
    assert.equal(iconOf(activeGroup), '#icon-web', 'the chosen icon carries through to the tree');
    assert.equal(activeGroup.textContent, 'Personal', 'and stays out of the name');
  });

  await t.test(
    'new group dialog: cancel and close buttons both dismiss without creating anything',
    () => {
      const groupCountBefore = q('#group-tree').querySelectorAll('.group-btn').length;

      q('[data-action="add-group"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      const dlg = byId<HTMLDialogElement>('dlg-new-group');
      byId<HTMLInputElement>('new-group-name').value = 'Abandoned';
      dq('#dlg-new-group [data-action="cancel-group"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);

      q('[data-action="add-group"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      dq('#dlg-new-group [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      assert.equal(q('#group-tree').querySelectorAll('.group-btn').length, groupCountBefore);
    },
  );

  await t.test(
    'group tree: rename, move (with own-subtree blocked), and delete/permanently-delete',
    () => {
      // Root has no actions of its own, so it gets no ⋯ at all.
      const rootBtn = (): HTMLButtonElement =>
        q('#group-tree').querySelector<HTMLButtonElement>('.group-btn') as HTMLButtonElement;
      assert.equal(rootBtn().closest('.group-row')?.querySelector('.group-menu-btn'), null);

      // The root's own label ("Personal Vault") would falsely match a plain
      // substring check against "Personal" — match on the trailing name instead.
      const groupBtnFor = (name: string): HTMLButtonElement =>
        Array.from(q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn')).find((b) =>
          b.textContent?.endsWith(name),
        ) as HTMLButtonElement;
      const rowFor = (name: string): HTMLElement =>
        groupBtnFor(name).closest('.group-row') as HTMLElement;
      const liFor = (name: string): HTMLElement => rowFor(name).closest('li') as HTMLElement;
      // The tree is always fully expanded, so a trashed/moved group's button
      // never disappears from #group-tree — it just relocates. Check its new
      // position (is it inside this parent's own subtree?) rather than mere
      // presence/absence.
      const isInSubtreeOf = (parentName: string, childName: string): boolean =>
        Array.from(
          liFor(parentName)
            .querySelector(':scope > ul')
            ?.querySelectorAll<HTMLButtonElement>('.group-btn') ?? [],
        ).some((b) => b.textContent?.endsWith(childName));
      const click = (el: EventTarget): void => {
        el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      };
      const menuItem = (name: string, label: string): HTMLButtonElement => {
        click(groupBtnFor(name)); // only the active row reveals its ⋯
        click(rowFor(name).querySelector('.group-menu-btn') as HTMLButtonElement);
        return Array.from(
          liFor(name).querySelectorAll<HTMLButtonElement>(':scope > .group-menu .group-menu-item'),
        ).find((b) => b.textContent === label) as HTMLButtonElement;
      };
      const clickHeaderDelete = (name: string): void => {
        click(groupBtnFor(name));
        click(q('[data-action="delete-group"]'));
      };
      const confirmDelete = (): void =>
        click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));
      const menuLabels = (name: string): string[] => {
        click(groupBtnFor(name));
        click(rowFor(name).querySelector('.group-menu-btn') as HTMLButtonElement);
        return Array.from(
          liFor(name).querySelectorAll<HTMLButtonElement>(':scope > .group-menu .group-menu-item'),
        ).map((b) => b.textContent ?? '');
      };
      const addRootGroup = (name: string): void => {
        click(rootBtn());
        click(q('[data-action="add-group"]'));
        byId<HTMLInputElement>('new-group-name').value = name;
        click(dq('#dlg-new-group [data-action="create-group"]'));
      };

      // Two new, root-level groups (not touching "Personal"/"Work", which
      // later steps in this walkthrough depend on).
      addRootGroup('Rename Target');
      addRootGroup('Move Target');

      // --- rename: reuses dlg-new-group, retitled and prefilled ---
      click(menuItem('Rename Target', 'Rename'));
      const groupDlg = byId<HTMLDialogElement>('dlg-new-group');
      assert.equal(byId<HTMLElement>('new-group-title').textContent, 'Rename group');
      assert.equal(byId<HTMLInputElement>('new-group-name').value, 'Rename Target');
      byId<HTMLInputElement>('new-group-name').value = 'Renamed Group';
      click(dq('#dlg-new-group [data-action="create-group"]'));
      assert.equal(groupDlg.open, false);
      assert.ok(groupBtnFor('Renamed Group'));
      assert.equal(groupBtnFor('Rename Target'), undefined);
      assert.equal(
        groupBtnFor('Renamed Group').title,
        'Renamed Group',
        'the full name is on hover, since the rail truncates',
      );

      // --- ⋯ toggles: pressing it again on the same row puts the menu away ---
      const openMenu = (name: string): Element | null =>
        liFor(name).querySelector(':scope > .group-menu');
      const menuBtnFor = (name: string): HTMLButtonElement =>
        rowFor(name).querySelector('.group-menu-btn') as HTMLButtonElement;
      click(groupBtnFor('Renamed Group'));
      click(menuBtnFor('Renamed Group'));
      assert.ok(openMenu('Renamed Group'), 'first press opens the menu');
      click(menuBtnFor('Renamed Group'));
      assert.equal(openMenu('Renamed Group'), null, 'second press closes it');

      // --- ⋯ claims the selection, so header delete cannot target another row ---
      click(groupBtnFor('Personal'));
      click(menuBtnFor('Work'));
      assert.ok(
        groupBtnFor('Work').classList.contains('active'),
        'opening ⋯ on a row makes that row the selection',
      );

      // --- move: a group cannot be moved into itself ---
      click(menuItem('Move Target', 'Move'));
      const moveDlg = byId<HTMLDialogElement>('dlg-move-to');
      assert.equal(moveDlg.open, true);
      assert.equal(byId<HTMLElement>('move-to-title').textContent, 'Move group to…');
      const destBtn = (name: string): HTMLButtonElement =>
        Array.from(
          byId<HTMLElement>('move-to-tree').querySelectorAll<HTMLButtonElement>('.move-to-btn'),
        ).find((b) => b.textContent?.endsWith(name)) as HTMLButtonElement;
      assert.equal(destBtn('Move Target').disabled, true);
      click(destBtn('Renamed Group'));
      assert.equal(moveDlg.open, false);
      assert.ok(
        isInSubtreeOf('Renamed Group', 'Move Target'),
        '"Move Target" is now nested under "Renamed Group"',
      );

      // One entry in the moved subtree, so the eventual permanent-delete
      // confirmation exercises its singular "1 entry" wording too (the
      // Recycle Bin test elsewhere covers the plural "0 entries" case).
      click(groupBtnFor('Move Target'));
      click(q('[data-action="add-entry"]'));
      click(q('[data-action="save"]'));
      click(dq('#dlg-save [data-action="close"]'));
      click(q('[data-action="back"]'));

      // --- move: a descendant is also an invalid target, and cancel/close both leave it in place ---
      click(menuItem('Renamed Group', 'Move'));
      assert.equal(destBtn('Renamed Group').disabled, true, 'self is not a valid target');
      assert.equal(destBtn('Move Target').disabled, true, 'own descendant is not a valid target');
      click(dq('#dlg-move-to [data-action="close"]'));
      assert.equal(moveDlg.open, false);

      click(menuItem('Renamed Group', 'Move'));
      click(dq('#dlg-move-to [data-action="cancel-move"]'));
      assert.equal(moveDlg.open, false);
      assert.equal(
        liFor('Renamed Group').querySelector(':scope > .group-menu'),
        null,
        'picking a menu item closes the menu even when the dialog is cancelled',
      );

      // --- a row's menu does not survive that row being deleted ---
      click(menuBtnFor('Renamed Group'));
      assert.ok(openMenu('Renamed Group'), 'menu is open before deleting');
      click(q('[data-action="delete-group"]'));
      assert.equal(openMenu('Renamed Group'), null, 'deleting closes the row menu');
      click(dq('#dlg-confirm-delete [data-action="cancel-delete"]'));

      // --- delete outside the bin: confirmed, then moves into Recycle Bin ---
      clickHeaderDelete('Renamed Group');
      const confirmDlg = byId<HTMLDialogElement>('dlg-confirm-delete');
      assert.equal(confirmDlg.open, true, 'trashing a group asks first');
      assert.equal(
        byId<HTMLElement>('confirm-delete-title').textContent,
        'Move to Recycle Bin?',
        'the reversible path does not read like the permanent one',
      );
      assert.match(byId<HTMLElement>('confirm-delete-message').textContent ?? '', /restored/);
      const confirmBtn = (): HTMLButtonElement =>
        dq<HTMLButtonElement>('#dlg-confirm-delete [data-action="confirm-delete"]');
      assert.equal(confirmBtn().textContent, 'Move to Bin', 'not a red Delete on a reversible act');
      assert.equal(confirmBtn().classList.contains('btn-danger'), false);
      click(dq('#dlg-confirm-delete [data-action="cancel-delete"]'));
      assert.equal(groupBtnFor('Recycle Bin'), undefined, 'cancelling creates no empty bin');

      clickHeaderDelete('Renamed Group');
      confirmDelete();
      assert.ok(groupBtnFor('Recycle Bin'), 'the recycle bin group is created on first trash');
      assert.ok(
        isInSubtreeOf('Recycle Bin', 'Renamed Group'),
        'trashing moves the group into the bin',
      );
      assert.ok(
        isInSubtreeOf('Renamed Group', 'Move Target'),
        'its own subtree moved along with it',
      );

      // --- undelete: offered only for a trashed group, and restores to root ---
      assert.deepEqual(menuLabels('Personal'), ['Rename', 'Move'], 'a live group has no undelete');
      assert.deepEqual(menuLabels('Renamed Group'), ['Rename', 'Move', 'Undelete']);
      assert.deepEqual(menuLabels('Recycle Bin'), ['Rename', 'Move'], 'the bin is not in itself');
      assert.equal(
        q<HTMLButtonElement>('[data-action="delete-group"]').disabled,
        true,
        'the bin cannot be deleted: that would take the permanent path and empty it',
      );
      click(menuItem('Renamed Group', 'Undelete'));
      assert.equal(
        isInSubtreeOf('Recycle Bin', 'Renamed Group'),
        false,
        'undelete pulls the group back out of the bin',
      );

      // Back into the bin, so the permanent-delete case below has its subject.
      clickHeaderDelete('Renamed Group');
      confirmDelete();

      // --- delete inside the bin: confirmed, permanent, whole subtree ---
      clickHeaderDelete('Renamed Group');
      assert.equal(confirmDlg.open, true);
      assert.equal(byId<HTMLElement>('confirm-delete-title').textContent, 'Delete group?');
      assert.equal(confirmBtn().textContent, 'Delete', 'the permanent path keeps its red Delete');
      assert.equal(confirmBtn().classList.contains('btn-danger'), true);
      // The 1 entry saved into "Move Target" earlier exercises the singular
      // wording; the Recycle Bin test elsewhere covers the plural case.
      assert.match(byId<HTMLElement>('confirm-delete-message').textContent ?? '', /\b1 entry\b/);
      confirmDelete();
      assert.equal(confirmDlg.open, false);
      assert.equal(groupBtnFor('Renamed Group'), undefined, 'permanently gone');
      assert.equal(groupBtnFor('Move Target'), undefined, 'its subtree went with it');

      // Back to "Personal", empty, for the rest of the walkthrough.
      click(groupBtnFor('Personal'));
      assert.equal(q<HTMLElement>('#panel-title').textContent, 'Personal');
      assert.equal(root().querySelectorAll('.entry-row').length, 0);
    },
  );

  await t.test('rail resize: pointer drag and arrow keys, clamped, re-applied on render', () => {
    const handle = (): HTMLElement => byId<HTMLElement>('sidebar-resize');
    const railWidth = (): string =>
      dom.window.document.documentElement.style.getPropertyValue('--sidebar-width');

    // jsdom has no layout engine, so getBoundingClientRect() is all zeros and
    // every drag here starts from a 0-width rail. That still exercises the
    // arithmetic and the clamps; the real geometry — that the default width
    // actually fits 25 characters — is asserted by the e2e suite, in a browser
    // that has layout.
    dispatch(handle(), 'pointerdown', { clientX: 100, pointerId: 1 });
    dispatch(handle(), 'pointermove', { clientX: 400, pointerId: 1 });
    assert.equal(railWidth(), '300px');
    assert.equal(handle().getAttribute('aria-valuenow'), '300');

    dispatch(handle(), 'pointermove', { clientX: 0, pointerId: 1 });
    assert.equal(railWidth(), '180px', 'clamped at the narrow end');
    dispatch(handle(), 'pointermove', { clientX: 9000, pointerId: 1 });
    assert.equal(railWidth(), '520px', 'clamped at the wide end');

    dispatch(handle(), 'pointerup', { clientX: 9000, pointerId: 1 });
    dispatch(handle(), 'pointermove', { clientX: 250, pointerId: 1 });
    assert.equal(railWidth(), '520px', 'releasing stops tracking the pointer');

    // Arrows step from the width already chosen rather than from the layout
    // engine, so direction is provable here even without one.
    dispatch(handle(), 'keydown', { key: 'ArrowLeft' });
    assert.equal(railWidth(), '504px', 'one step narrower than the 520 just dragged to');
    dispatch(handle(), 'keydown', { key: 'a' });
    assert.equal(railWidth(), '504px', 'unchanged by a non-arrow key');
    dispatch(handle(), 'keydown', { key: 'ArrowRight' });
    assert.equal(railWidth(), '520px', 'one step wider, back at the ceiling');

    // The custom property outlives a re-render, but the handle carrying the
    // aria value does not, so the fresh one has to be resynced from memory.
    dispatch(q('[data-action="add-group"]'), 'click');
    byId<HTMLInputElement>('new-group-name').value = 'Width Survivor';
    dispatch(dq('#dlg-new-group [data-action="create-group"]'), 'click');
    assert.equal(railWidth(), '520px');
    assert.equal(handle().getAttribute('aria-valuenow'), '520', 'the new handle is resynced');
  });

  await t.test('adding a new entry opens the edit screen, prefilled with standard fields', () => {
    q('[data-action="add-entry"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(q<HTMLElement>('#edit-title').textContent, 'New Entry');

    const keyInputs = Array.from(root().querySelectorAll<HTMLInputElement>('.edit-key'));
    const keys = keyInputs.map((i) => i.value);
    assert.deepEqual(keys, ['Title', 'UserName', 'Password', 'URL', 'Notes']);
    // Standard fields are not removable (no remove button rendered for them).
    for (const keyInput of keyInputs) {
      const row = keyInput.closest('.edit-field') as HTMLElement;
      assert.equal(row.querySelector('[title="Remove field"]'), null);
      // Grouped apart from the row's own spacing, so they sit close together (#89).
      for (const button of row.querySelectorAll('.icon-btn')) {
        assert.equal(button.parentElement?.className, 'edit-actions');
      }
      // Copy leads the value here too, the same as everywhere else (#87).
      const lead = keyInput.nextElementSibling;
      assert.ok(lead?.querySelector('[title="Copy"]'), `copy leads the ${keyInput.value} value`);
      assert.ok(lead?.nextElementSibling?.classList.contains('edit-value'));
    }

    // Title leads, empty and ready to type, with nothing to delete first (#89).
    const titleValue = root().querySelector<HTMLInputElement>('.edit-value');
    assert.equal(titleValue?.value, '');
    assert.equal(dom.window.document.activeElement, titleValue);
    assert.ok(
      q('#edit-fields').compareDocumentPosition(q('#edit-tags')) &
        dom.window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the fields come before tags and expiry',
    );
    const notesRow = keyInputs.find((k) => k.value === 'Notes')?.closest('.edit-field');
    assert.equal(notesRow?.querySelector('.edit-value')?.tagName, 'TEXTAREA', 'notes take lines');
  });

  await t.test(
    'the entry icon picker defaults to Key, can be closed without picking, and shows the choice made',
    () => {
      const iconBtn = q<HTMLButtonElement>('#edit-icon-btn');
      assert.equal(iconOf(iconBtn), '#icon-key', 'new entries default to the Key icon');

      // Closing (✕) without picking anything leaves the icon unchanged.
      iconBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const dlg = byId<HTMLDialogElement>('dlg-icon-picker');
      assert.equal(dlg.open, true);
      dq('#dlg-icon-picker [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      assert.equal(iconOf(iconBtn), '#icon-key');

      iconBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const bankOption = Array.from(
        byId<HTMLElement>('icon-grid').querySelectorAll<HTMLButtonElement>('.icon-grid-btn'),
      ).find((b) => b.title === 'Bank') as HTMLButtonElement;
      bankOption.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(dlg.open, false);
      assert.equal(iconOf(iconBtn), '#icon-bank');
    },
  );

  await t.test('add-field adds a removable custom field row', () => {
    const before = root().querySelectorAll('.edit-field').length;
    q('[data-action="add-field"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const rows = root().querySelectorAll('.edit-field');
    assert.equal(rows.length, before + 1);
    const newRow = rows[rows.length - 1] as HTMLElement;
    assert.ok(newRow.querySelector('[title="Remove field"]'));

    // The remove button actually removes the row.
    newRow.querySelector<HTMLButtonElement>('[title="Remove field"]')?.click();
    assert.equal(root().querySelectorAll('.edit-field').length, before);
  });

  await t.test(
    'the password generator fills the Password field, and an empty selection blocks "use"',
    () => {
      const passwordRow = Array.from(root().querySelectorAll('.edit-field')).find(
        (row) => row.querySelector<HTMLInputElement>('.edit-key')?.value === 'Password',
      ) as HTMLElement;
      const valueInput = passwordRow.querySelector<HTMLInputElement>(
        '.edit-value',
      ) as HTMLInputElement;
      const generateBtn = passwordRow.querySelector<HTMLButtonElement>(
        '[title="Generate password"]',
      );
      assert.ok(generateBtn);

      generateBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const dlg = byId<HTMLDialogElement>('dlg-generate-password');
      assert.equal(dlg.open, true);
      const preview = byId<HTMLElement>('generator-preview');
      assert.equal(preview.textContent?.length, 20);

      const firstPreview = preview.textContent;
      dq('#dlg-generate-password [data-action="regenerate"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.notEqual(preview.textContent, firstPreview);

      // Unchecking every character class shows an error and clears the
      // preview; "Use this password" is then a no-op.
      for (const id of ['generator-upper', 'generator-lower', 'generator-digits']) {
        const checkbox = byId<HTMLInputElement>(id);
        checkbox.checked = false;
        dispatch(checkbox, 'input');
      }
      assert.equal(byId<HTMLElement>('generator-error').hidden, false);
      assert.equal(preview.textContent, '');
      dq('#dlg-generate-password [data-action="use-password"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, true, 'nothing generated yet, so the dialog stays open');

      // Re-enabling a class regenerates a usable password again.
      const lowerCheckbox = byId<HTMLInputElement>('generator-lower');
      lowerCheckbox.checked = true;
      dispatch(lowerCheckbox, 'input');
      assert.equal(byId<HTMLElement>('generator-error').hidden, true);
      const finalPreview = preview.textContent;
      assert.ok(finalPreview);

      dq('#dlg-generate-password [data-action="use-password"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      assert.equal(valueInput.value, finalPreview);

      // The close (✕) button dismisses without applying anything.
      generateBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      dq('#dlg-generate-password [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      assert.equal(valueInput.value, finalPreview, 'closing must not touch the field');

      // A non-Error throw (generatePassword itself never does this; the
      // guard exists for whatever might) still shows a fallback message.
      const globalGenerator = globalThis as unknown as {
        generatePassword: typeof generatePassword;
      };
      const realGenerate = globalGenerator.generatePassword;
      globalGenerator.generatePassword = () => {
        throw 'not an Error instance';
      };
      try {
        generateBtn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      } finally {
        globalGenerator.generatePassword = realGenerate;
      }
      assert.equal(byId<HTMLElement>('generator-error').hidden, false);
      assert.equal(
        byId<HTMLElement>('generator-error').textContent,
        'Could not generate a password.',
      );
      dq('#dlg-generate-password [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
    },
  );

  await t.test('cancelling a brand-new entry deletes it and returns to the entry list', () => {
    // Currently on the entry-edit screen for the entry just added to the
    // freshly-created, still-empty "Personal" group — cancelling a new,
    // unsaved entry must remove it again, leaving the group empty.
    q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.ok(q('#group-tree'), 'back on the entry list screen');
    assert.equal(root().querySelectorAll('.entry-row').length, 0);
  });

  await t.test('saving a new entry commits fields, then opens the save-database dialog', () => {
    q('[data-action="add-entry"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const [titleInput, userInput] = root().querySelectorAll<HTMLInputElement>('.edit-value');
    (titleInput as HTMLInputElement).value = 'Custom Title';
    (userInput as HTMLInputElement).value = 'custom-user';
    const notesInput = root().querySelector<HTMLTextAreaElement>('textarea.edit-value');
    (notesInput as HTMLTextAreaElement).value = 'first line\nsecond line';

    q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    assert.ok(q<HTMLElement>('#detail-title').textContent?.includes('Custom Title'));
    assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);
    const notesValue = Array.from(root().querySelectorAll('.detail-field'))
      .find((row) => row.querySelector('.detail-label')?.textContent === 'Notes')
      ?.querySelector('.detail-value');
    assert.equal(notesValue?.textContent, 'first line\nsecond line', 'both lines kept (#89)');
    // On the card, each copy control leads the value it copies (#87).
    for (const wrap of root().querySelectorAll('.detail-value-wrap')) {
      assert.equal(wrap.firstElementChild?.getAttribute('title'), 'Copy');
      assert.ok(wrap.firstElementChild?.nextElementSibling?.classList.contains('detail-value'));
    }
  });

  await t.test('save dialog: "Later" dismisses without downloading', () => {
    dq('#dlg-save [data-action="close"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(byId<HTMLDialogElement>('dlg-save').open, false);
  });

  await t.test('downloading the database creates and revokes an object URL', async () => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    q<HTMLInputElement>('.edit-value').value += ' (edited)'; // Save writes only a change (#134)
    q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);

    const created: string[] = [];
    const revoked: string[] = [];
    const realCreate = URL.createObjectURL.bind(URL);
    const realRevoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => {
      const u = realCreate(obj);
      created.push(u);
      return u;
    };
    URL.revokeObjectURL = (u: string) => {
      revoked.push(u);
      realRevoke(u);
    };
    try {
      dq('#dlg-save [data-action="download"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      await waitFor(() => byId<HTMLDialogElement>('dlg-save').open === false);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    assert.equal(created.length, 1);
    assert.deepEqual(revoked, created);
  });

  await t.test(
    'tags entered on the edit screen show as chips on the detail screen, and round-trip back into the tags input on re-edit',
    () => {
      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q<HTMLInputElement>('#edit-tags').value, '', 'no tags set yet');
      q<HTMLInputElement>('#edit-tags').value = 'Work, Urgent ;; Personal';
      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

      const chips = Array.from(q('#detail-tags').querySelectorAll('.tag-chip')).map(
        (el) => el.textContent,
      );
      assert.deepEqual(chips, ['Work', 'Urgent', 'Personal']);
      dq('#dlg-save [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q<HTMLInputElement>('#edit-tags').value, 'Work, Urgent, Personal');
      q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.ok(q<HTMLElement>('#detail-title').textContent?.includes('Custom Title'));
    },
  );

  await t.test(
    'setting an expiration shows on the detail screen, and unchecking disables the datetime input again',
    () => {
      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const expiresCheckbox = q<HTMLInputElement>('#edit-expires');
      const expiryInput = q<HTMLInputElement>('#edit-expiry-time');
      assert.equal(expiresCheckbox.checked, false);
      assert.equal(expiryInput.disabled, true);

      expiresCheckbox.checked = true;
      dispatch(expiresCheckbox, 'change');
      assert.equal(expiryInput.disabled, false);
      assert.ok(expiryInput.value, 'checking Expires with no prior date fills in a default');

      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.match(q<HTMLElement>('#detail-meta').textContent ?? '', /Expires/);
      dq('#dlg-save [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      // Re-entering edit reflects the saved state; unchecking disables the input again.
      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q<HTMLInputElement>('#edit-expires').checked, true);
      assert.equal(q<HTMLInputElement>('#edit-expiry-time').disabled, false);
      const expiryInputAgain = q<HTMLInputElement>('#edit-expiry-time');
      const savedValue = expiryInputAgain.value;
      q<HTMLInputElement>('#edit-expires').checked = false;
      dispatch(q<HTMLInputElement>('#edit-expires'), 'change');
      assert.equal(expiryInputAgain.disabled, true);

      // Re-checking with a date already present (retained from before, just
      // disabled) must not clobber it with a fresh default.
      q<HTMLInputElement>('#edit-expires').checked = true;
      dispatch(q<HTMLInputElement>('#edit-expires'), 'change');
      assert.equal(expiryInputAgain.value, savedValue);

      q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.ok(q<HTMLElement>('#detail-title').textContent?.includes('Custom Title'));
    },
  );

  await t.test(
    'attachments can be added, shown on both edit and detail screens, renamed, downloaded, and removed',
    async () => {
      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q('#edit-attachments').children.length, 0);

      const attachmentInput = q<HTMLInputElement>('#edit-attachment-input');
      // A change event with the picker cancelled (no file chosen) is a no-op.
      setFiles(attachmentInput, []);
      dispatch(attachmentInput, 'change');
      assert.equal(q('#edit-attachments').children.length, 0);

      setFiles(attachmentInput, [makeFile('notes.txt', new TextEncoder().encode('hello'))]);
      dispatch(attachmentInput, 'change');
      await waitFor(() => q('#edit-attachments').children.length === 1);
      assert.equal(q<HTMLInputElement>('.attachment-name').value, 'notes.txt');

      // Rename it; a blank rename is a no-op that keeps the old name.
      q<HTMLInputElement>('.attachment-name').value = 'renamed.txt';
      dispatch(q<HTMLInputElement>('.attachment-name'), 'change');
      assert.equal(q<HTMLInputElement>('.attachment-name').value, 'renamed.txt');
      q<HTMLInputElement>('.attachment-name').value = '   ';
      dispatch(q<HTMLInputElement>('.attachment-name'), 'change');
      assert.equal(q<HTMLInputElement>('.attachment-name').value, 'renamed.txt');

      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const detailRow = q('#detail-attachments .attachment-row');
      assert.ok(detailRow, 'the attachment shows on the detail screen too');
      assert.equal(detailRow.querySelector('.attachment-name')?.textContent, 'renamed.txt');

      const created: string[] = [];
      const revoked: string[] = [];
      const realCreate = URL.createObjectURL.bind(URL);
      const realRevoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        const u = realCreate(obj);
        created.push(u);
        return u;
      };
      URL.revokeObjectURL = (u: string) => {
        revoked.push(u);
        realRevoke(u);
      };
      try {
        q<HTMLButtonElement>('[title="Download"]').click();
      } finally {
        URL.createObjectURL = realCreate;
        URL.revokeObjectURL = realRevoke;
      }
      assert.equal(created.length, 1);
      assert.deepEqual(revoked, created);

      dq('#dlg-save [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      q<HTMLButtonElement>('[title="Remove attachment"]').click();
      assert.equal(q('#edit-attachments').children.length, 0);

      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q('#detail-attachments').children.length, 0);
      dq('#dlg-save [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
    },
  );

  await t.test(
    'Save refuses two fields of one name, naming it and changing nothing until one is renamed (#125)',
    () => {
      // KeePassXC refuses to open a file holding such an entry.
      const historyRows = () => q('#detail-history').querySelectorAll('.history-row').length;
      const historyBefore = historyRows();
      q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(q<HTMLElement>('#edit-error').hidden, true);

      q('[data-action="add-field"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      const rows = root().querySelectorAll<HTMLElement>('.edit-field');
      const added = rows[rows.length - 1] as HTMLElement;
      const addedKey = added.querySelector<HTMLInputElement>('.edit-key') as HTMLInputElement;
      addedKey.value = ' Password ';
      (added.querySelector('.edit-value') as HTMLInputElement).value = 'shadow';
      addedKey.blur();

      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const error = q<HTMLElement>('#edit-error');
      assert.equal(error.hidden, false);
      assert.equal(
        error.textContent,
        'More than one field is named "Password". Rename or remove one, then save.',
      );
      assert.equal(dom.window.document.activeElement, addedKey, 'the clashing name is focused');
      assert.ok(q('#edit-title'), 'still on the edit screen');
      assert.equal(byId<HTMLDialogElement>('dlg-save').open, false);

      addedKey.value = 'Recovery code';
      q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);
      const labels = Array.from(root().querySelectorAll('.detail-label')).map((l) => l.textContent);
      assert.equal(labels.filter((label) => label === 'Password').length, 1);
      assert.ok(labels.includes('Recovery code'));
      assert.equal(
        historyRows(),
        historyBefore + 1,
        'only the save that went through kept History',
      );
      dq('#dlg-save [data-action="close"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
    },
  );

  await t.test('no control in the edit row takes the caret out of the value field', () => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const passwordRow = Array.from(root().querySelectorAll('.edit-field')).find(
      (row) => row.querySelector<HTMLInputElement>('.edit-key')?.value === 'Password',
    ) as HTMLElement;

    for (const title of ['Show / hide', 'Copy', 'Generate password']) {
      const control = passwordRow.querySelector<HTMLButtonElement>(`[title="${title}"]`);
      assert.ok(control, `the password row carries a "${title}" control`);
      assert.ok(dispatch(control, 'mousedown').defaultPrevented, `"${title}" keeps the caret put`);
    }

    q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  });

  // The same as the unlock screen's reveal, for the same reason (#110).
  await t.test('revealing a value in the edit row puts the caret in its field', () => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const passwordRow = Array.from(root().querySelectorAll('.edit-field')).find(
      (row) => row.querySelector<HTMLInputElement>('.edit-key')?.value === 'Password',
    ) as HTMLElement;
    const valueInput = passwordRow.querySelector('.edit-value') as HTMLInputElement;
    valueInput.blur();
    assert.notEqual(dom.window.document.activeElement, valueInput);

    passwordRow.querySelector<HTMLButtonElement>('[title="Show / hide"]')?.click();
    assert.equal(valueInput.type, 'text');
    assert.equal(dom.window.document.activeElement, valueInput);

    q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  });

  await t.test('editing an existing entry (not new) cancels back to the detail screen', () => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(q<HTMLElement>('#edit-title').textContent, 'Edit Entry');

    // The edit screen's own password-field show/hide toggle (distinct from
    // the detail screen's reveal button, tested separately below).
    const passwordRow = Array.from(root().querySelectorAll('.edit-field')).find(
      (row) => (row as HTMLElement).dataset.protected === '1',
    ) as HTMLElement;
    const valueInput = passwordRow.querySelector<HTMLInputElement>('.edit-value');
    const toggleBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Show / hide"]');
    assert.equal(valueInput?.type, 'password');
    toggleBtn?.click();
    assert.equal(valueInput?.type, 'text');
    toggleBtn?.click();
    assert.equal(valueInput?.type, 'password');

    q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.ok(q<HTMLElement>('#detail-title').textContent?.includes('Custom Title'));
  });

  await t.test('a protected field can be revealed and hidden again', () => {
    const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
      (row) => row.querySelector('.detail-label')?.textContent === 'Password',
    ) as HTMLElement;
    const valueSpan = passwordRow.querySelector('.detail-value') as HTMLElement;
    assert.equal(valueSpan.textContent, '••••••••');

    const revealBtn = passwordRow.querySelector('[title="Show / hide"]') as HTMLButtonElement;
    revealBtn.click();
    assert.notEqual(valueSpan.textContent, '••••••••');
    assert.equal(iconOf(revealBtn), '#icon-eye-off');
    revealBtn.click();
    assert.equal(valueSpan.textContent, '••••••••');
    assert.equal(iconOf(revealBtn), '#icon-eye');
  });

  await t.test('the print button calls window.print()', () => {
    let printCalls = 0;
    const realPrint = dom.window.print;
    dom.window.print = () => {
      printCalls++;
    };
    try {
      q('[data-action="print"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    } finally {
      dom.window.print = realPrint;
    }
    assert.equal(printCalls, 1);
  });

  await t.test(
    'copying a field writes to the clipboard, announces it, and clears on a timer',
    async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const usernameRow = Array.from(root().querySelectorAll('.detail-field')).find(
        (row) => row.querySelector('.detail-label')?.textContent === 'UserName',
      ) as HTMLElement;
      const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
        (row) => row.querySelector('.detail-label')?.textContent === 'Password',
      ) as HTMLElement;
      const copyBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Copy"]');
      const toast = byId<HTMLElement>('toast');
      const message = (): string | null => byId<HTMLElement>('toast-message').textContent;
      const countdown = (): string | null => byId<HTMLElement>('toast-countdown').textContent;
      // The writes happen inside an async handler; setImmediate is not mocked,
      // so waiting on it lets every microtask settle before the next step.
      const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

      clipboardWritesShouldFail = false;
      usernameRow.querySelector<HTMLButtonElement>('[title="Copy"]')?.click();
      await settle();
      assert.equal(message(), 'Username copied to clipboard', "not KeePass's own 'UserName'");

      copyBtn?.click();
      await settle();
      // The toast names the field and never carries the value itself (#67).
      assert.equal(toast.hidden, false);
      assert.equal(message(), 'Password copied to clipboard');

      // It counts down to the clear, a whole second at a time (#88).
      assert.equal(countdown(), 'clears in 30s');
      t.mock.timers.tick(1_000);
      assert.equal(countdown(), 'clears in 29s');
      t.mock.timers.tick(500);
      assert.equal(countdown(), 'clears in 29s', 'no tick between whole seconds');

      // A fresh copy restarts the clock rather than inheriting the old one.
      copyBtn?.click();
      await settle();
      assert.equal(countdown(), 'clears in 30s');

      // A browser refuses a timed clear while the user is off pasting elsewhere
      // (or, in some browsers, always), so the value is still there and the
      // reminder must say what happens next.
      clipboardText = 'still there when the timer fires';
      clipboardWritesShouldFail = true;
      t.mock.timers.tick(30_000);
      await settle();
      assert.equal(clipboardText, 'still there when the timer fires');
      assert.equal(toast.hidden, false);
      assert.equal(countdown(), 'clears when you next click or type');
      const countdownHidden = (): string | null =>
        byId<HTMLElement>('toast-countdown').getAttribute('aria-hidden');
      assert.equal(countdownHidden(), 'false', 'a screen reader hears this one, not the ticks');

      // A retry the browser still refuses keeps waiting for the next chance.
      dom.window.dispatchEvent(new dom.window.Event('keydown'));
      await settle();
      clipboardWritesShouldFail = false;
      assert.equal(clipboardText, 'still there when the timer fires');
      assert.equal(toast.hidden, false);

      // The next click lets it through, and nothing retries after that.
      dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
      await settle();
      assert.equal(clipboardText, '', 'cleared at the click');
      assert.equal(toast.hidden, true, 'so the reminder retires');
      clipboardText = 'copied in another app';
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      await settle();
      assert.equal(clipboardText, 'copied in another app', 'the retry is spent');

      // A copy made while a clear is still waiting owns the clipboard now; that
      // stale clear must not wipe it the moment focus returns.
      copyBtn?.click();
      await settle();
      clipboardWritesShouldFail = true;
      t.mock.timers.tick(30_000);
      await settle();
      clipboardWritesShouldFail = false;
      copyBtn?.click();
      await settle();
      dom.window.dispatchEvent(new dom.window.Event('focus'));
      await settle();
      assert.equal(toast.hidden, false, 'the stale clear never ran');
      assert.equal(countdown(), 'clears in 30s');
      assert.equal(countdownHidden(), 'true', 'and the ticks are silent again');

      t.mock.timers.tick(30_000);
      await settle();
      assert.equal(toast.hidden, true, 'the new value is cleared on its own schedule');
    },
  );

  await t.test(
    'clipboard writes take turns, so a late result never undoes a newer one',
    async (t) => {
      t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
      const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
        (row) => row.querySelector('.detail-label')?.textContent === 'Password',
      ) as HTMLElement;
      const copyBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Copy"]');
      const toast = byId<HTMLElement>('toast');
      const countdown = (): string | null => byId<HTMLElement>('toast-countdown').textContent;
      const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

      // Leave a refused clear behind, so focus, clicks and keys all retry it.
      clipboardWritesShouldFail = false;
      copyBtn?.click();
      await settle();
      clipboardWritesShouldFail = true;
      t.mock.timers.tick(30_000);
      await settle();
      clipboardWritesShouldFail = false;
      assert.equal(countdown(), 'clears when you next click or type');

      // Clicking back in fires focus and pointerdown together, both retrying, and
      // the click itself lands a copy straight after them.
      const held: HeldWrite[] = [];
      heldWrites = held;
      try {
        dom.window.dispatchEvent(new dom.window.Event('focus'));
        dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
        copyBtn?.click();
        await settle();
        assert.equal(held.length, 1, 'one write in flight at a time');

        held[0]?.settle(false); // focus alone is not enough for some browsers
        await settle();
        assert.equal(held.length, 2, 'the next starts only once the first is applied');
        held[1]?.settle(true); // the click is
        await settle();
        assert.equal(toast.hidden, true);
        assert.equal(held.length, 3);
        held[2]?.settle(true);
        await settle();
      } finally {
        heldWrites = null;
      }
      assert.equal(toast.hidden, false, 'the copy, applied last, owns the toast');
      assert.equal(countdown(), 'clears in 30s');
      dom.window.dispatchEvent(new dom.window.Event('keydown'));
      await settle();
      assert.equal(held.length, 3, 'and no stale retry is left armed to wipe it');

      t.mock.timers.tick(30_000);
      await settle();
      assert.equal(toast.hidden, true);
    },
  );

  await t.test('the edit screen has copy buttons too, copying the currently typed value', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    const passwordRow = Array.from(root().querySelectorAll('.edit-field')).find(
      (row) => row.querySelector<HTMLInputElement>('.edit-key')?.value === 'Password',
    ) as HTMLElement;
    const valueInput = passwordRow.querySelector<HTMLInputElement>(
      '.edit-value',
    ) as HTMLInputElement;
    const copyBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Copy"]');
    assert.ok(copyBtn, 'edit fields have a copy button, same as detail fields');

    // Not yet saved — proves the button copies the live input, not the
    // value the field was opened with.
    valueInput.value = 'not-yet-saved-password';
    clipboardWritesShouldFail = false;
    const keyInput = passwordRow.querySelector<HTMLInputElement>('.edit-key') as HTMLInputElement;
    keyInput.value = '';
    copyBtn?.click();
    keyInput.value = 'Password';

    return Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        assert.equal(clipboardText, 'not-yet-saved-password');
        assert.equal(
          byId<HTMLElement>('toast-message').textContent,
          'Value copied to clipboard',
          'an unnamed field still names something',
        );
        q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      });
  });

  await t.test('a clipboard write failure is caught and logged, not thrown', async () => {
    const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
      (row) => row.querySelector('.detail-label')?.textContent === 'Password',
    ) as HTMLElement;
    const copyBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Copy"]');

    // Record every console.error call rather than assuming the first one
    // captured is ours — unrelated, asynchronously-flushed process output
    // (e.g. Node's one-time ExperimentalWarning for the mock timers used in
    // the previous test) can otherwise land in the same window.
    const realError = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      calls.push(args);
    };
    clipboardWritesShouldFail = true;
    try {
      copyBtn?.click();
      await waitFor(() => calls.some((args) => args[0] === 'Clipboard write failed'));
    } finally {
      console.error = realError;
      clipboardWritesShouldFail = false;
    }
    assert.ok(calls.some((args) => args[0] === 'Clipboard write failed'));
  });

  await t.test(
    'moving an entry to another group reparents it, leaving the source group empty',
    () => {
      // Currently on the detail screen for "Custom Title", the sole entry in
      // "Personal". Move it into "Work", then back again, so the next
      // (trashing) test finds things exactly as it expects.
      const destBtn = (name: string): HTMLButtonElement =>
        Array.from(
          byId<HTMLElement>('move-to-tree').querySelectorAll<HTMLButtonElement>('.move-to-btn'),
        ).find((b) => b.textContent?.endsWith(name)) as HTMLButtonElement;
      const clickGroupNamed = (name: string): void => {
        const btn = Array.from(
          q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'),
        ).find((b) => b.textContent?.endsWith(name));
        assert.ok(btn, `expected a "${name}" group button`);
        btn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      };

      q('[data-action="move-entry"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      const dlg = byId<HTMLDialogElement>('dlg-move-to');
      assert.equal(dlg.open, true);
      assert.equal(byId<HTMLElement>('move-to-title').textContent, 'Move entry to…');
      destBtn('Work').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(dlg.open, false);

      assert.ok(q('#group-tree'), 'back on the entry list');
      assert.equal(root().querySelectorAll('.entry-row').length, 0, 'Personal is now empty');

      clickGroupNamed('Work');
      const movedRow = Array.from(root().querySelectorAll('.entry-row')).find((r) =>
        r.querySelector('.entry-row-title')?.textContent?.includes('Custom Title'),
      );
      assert.ok(movedRow, 'the entry is now in "Work"');
      assert.equal(root().querySelectorAll('.entry-row').length, 2, 'alongside the existing entry');

      // Move it back to "Personal" for the rest of the walkthrough.
      movedRow?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      q('[data-action="move-entry"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      destBtn('Personal').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      clickGroupNamed('Personal');
      const backRow = Array.from(root().querySelectorAll('.entry-row')).find((r) =>
        r.querySelector('.entry-row-title')?.textContent?.includes('Custom Title'),
      );
      assert.ok(backRow, 'moved back to "Personal"');
      backRow?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    },
  );

  await t.test(
    'trashing an entry moves it to a Recycle Bin group; restoring returns it to its group; deleting it there confirms and removes it permanently',
    () => {
      const clickGroupNamed = (name: string): void => {
        const btn = Array.from(
          q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'),
        ).find((b) => b.textContent?.includes(name));
        assert.ok(btn, `expected a "${name}" group button`);
        btn?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      };

      // Currently viewing "Custom Title", the sole entry in the "Personal"
      // group. Outside the bin, Trash is the only destructive action shown.
      q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      (q('.entry-row') as HTMLElement).dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(q('[data-action="trash"]').hasAttribute('hidden'), false);
      assert.equal(q('[data-action="restore"]').hasAttribute('hidden'), true);
      assert.equal(q('[data-action="delete"]').hasAttribute('hidden'), true);

      q('[data-action="trash"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.ok(q('#group-tree'), 'back on the entry list');
      assert.equal(root().querySelectorAll('.entry-row').length, 0, 'Personal is empty again');

      clickGroupNamed('Recycle Bin');
      assert.equal(root().querySelectorAll('.entry-row').length, 1);
      (q('.entry-row') as HTMLElement).dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.ok(q<HTMLElement>('#detail-title').textContent?.includes('Custom Title'));
      assert.equal(q('[data-action="trash"]').hasAttribute('hidden'), true);
      assert.equal(q('[data-action="restore"]').hasAttribute('hidden'), false);
      assert.equal(q('[data-action="delete"]').hasAttribute('hidden'), false);

      // Restoring puts it back in the group it was trashed from (#133).
      q('[data-action="restore"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      Array.from(q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'))
        .find((b) => b.textContent?.trim().endsWith('Personal'))
        ?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const restoredRow = Array.from(root().querySelectorAll('.entry-row')).find((r) =>
        r.querySelector('.entry-row-title')?.textContent?.includes('Custom Title'),
      );
      assert.ok(restoredRow, 'restoring returns the entry to Personal');

      // Trash it again, then permanently delete it from the bin.
      restoredRow?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      q('[data-action="trash"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      clickGroupNamed('Recycle Bin');
      (q('.entry-row') as HTMLElement).dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      q('[data-action="delete"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      let dlg = byId<HTMLDialogElement>('dlg-confirm-delete');
      assert.equal(dlg.open, true);
      dq('#dlg-confirm-delete [data-action="cancel-delete"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      assert.equal(q<HTMLElement>('#detail-title') !== null, true, 'still on the detail screen');

      q('[data-action="delete"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      dlg = byId<HTMLDialogElement>('dlg-confirm-delete');
      dq('#dlg-confirm-delete [data-action="confirm-delete"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
      clickGroupNamed('Recycle Bin');
      assert.equal(
        root().querySelectorAll('.entry-row').length,
        0,
        'permanently deleted from the bin',
      );
    },
  );

  await t.test('settings: valid timeouts are saved, out-of-range ones are ignored', () => {
    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    let dlg = byId<HTMLDialogElement>('dlg-settings');
    assert.equal(byId<HTMLInputElement>('clipboard-timeout').value, '30');
    assert.equal(byId<HTMLInputElement>('curtain-timeout').value, '60');
    assert.equal(byId<HTMLInputElement>('auto-lock-timeout').value, '300');

    byId<HTMLInputElement>('clipboard-timeout').value = '10';
    byId<HTMLInputElement>('curtain-timeout').value = '20';
    byId<HTMLInputElement>('auto-lock-timeout').value = '45';
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);

    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLInputElement>('clipboard-timeout').value, '10');
    assert.equal(byId<HTMLInputElement>('curtain-timeout').value, '20');
    assert.equal(byId<HTMLInputElement>('auto-lock-timeout').value, '45');
    byId<HTMLInputElement>('clipboard-timeout').value = '2';
    byId<HTMLInputElement>('curtain-timeout').value = '10';
    byId<HTMLInputElement>('auto-lock-timeout').value = '5';
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );

    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(
      byId<HTMLInputElement>('clipboard-timeout').value,
      '10',
      'an out-of-range timeout must not overwrite the saved one',
    );
    assert.equal(
      byId<HTMLInputElement>('curtain-timeout').value,
      '20',
      'nor an out-of-range curtain delay',
    );
    assert.equal(
      byId<HTMLInputElement>('auto-lock-timeout').value,
      '45',
      'and neither must an out-of-range auto-lock delay',
    );
    // Nor a lock put off past the hour, since unlocking is when a newer version is checked for (#74).
    byId<HTMLInputElement>('auto-lock-timeout').value = '86400';
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLInputElement>('auto-lock-timeout').value, '45');
    // The idle clock runs in real time here, so the rest of this walkthrough
    // gets the longest delays rather than a curtain or lock partway through.
    byId<HTMLInputElement>('curtain-timeout').value = '3600';
    byId<HTMLInputElement>('auto-lock-timeout').value = '3600';
    dlg = byId<HTMLDialogElement>('dlg-settings');
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);
  });

  await t.test(
    'settings: changing the master password updates the database credentials',
    async () => {
      q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const dlg = byId<HTMLDialogElement>('dlg-settings');
      assert.equal(byId<HTMLInputElement>('settings-new-password').value, '');
      assert.equal(byId<HTMLElement>('settings-keyfile-label').textContent, 'No file chosen');

      // Mismatched passwords: rejected, dialog stays open.
      byId<HTMLInputElement>('settings-new-password').value = 'new-pass';
      byId<HTMLInputElement>('settings-new-password-confirm').value = 'does-not-match';
      dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, true);
      assert.equal(byId<HTMLElement>('settings-security-error').hidden, false);

      // Matching passwords: applied, dialog closes.
      byId<HTMLInputElement>('settings-new-password-confirm').value = 'new-pass';
      dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);

      // The change is a real, unsaved edit — closing now needs confirmation.
      q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      assert.equal(byId<HTMLDialogElement>('dlg-confirm-discard').open, true);
      dq('#dlg-confirm-discard [data-action="cancel-discard"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );

      // Restore the original credentials (including the key file), so later
      // steps in this walkthrough — which unlock with PASSWORD/KEYFILE —
      // keep working.
      q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      byId<HTMLInputElement>('settings-new-password').value = PASSWORD;
      byId<HTMLInputElement>('settings-new-password-confirm').value = PASSWORD;
      const settingsKeyfileInput = byId<HTMLInputElement>('settings-keyfile-input');
      setFiles(settingsKeyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
      dispatch(settingsKeyfileInput, 'change');
      await waitFor(
        () => byId<HTMLElement>('settings-keyfile-label').textContent === 'keyfile.bin',
      );
      dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(dlg.open, false);
    },
  );

  await t.test(
    'locking with unsaved edits asks first; "Lock Anyway" re-encrypts the current state and returns to the unlock screen, and the edit is still marked unsaved after re-unlocking',
    async () => {
      assert.equal(
        q<HTMLButtonElement>('[data-action="save-database"]').disabled,
        false,
        'the persistent save indicator reflects the unsaved edits made earlier in this walkthrough',
      );
      // A value copied earlier in this walkthrough is still on the clipboard.
      assert.equal(byId<HTMLElement>('toast').hidden, false);
      clipboardText = 'copied earlier';

      q('[data-action="lock"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const lockDlg = byId<HTMLDialogElement>('dlg-confirm-discard');
      assert.equal(lockDlg.open, true);
      assert.equal(byId<HTMLElement>('confirm-discard-title').textContent, 'Lock without saving?');
      assert.equal(
        dq<HTMLButtonElement>('[data-action="confirm-discard"]').textContent,
        'Lock Anyway',
      );

      dq('[data-action="confirm-discard"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      assert.equal(lockDlg.open, false);
      await waitFor(() => q('#master-password') !== null);
      assert.equal(q<HTMLElement>('#db-filename').textContent, 'real.kdbx');
      assert.equal(dom.window.document.title, 'real.kdbx - Locked - KeePass Web');
      // It does not outlast the lock (#88).
      assert.equal(clipboardText, '');
      assert.equal(byId<HTMLElement>('toast').hidden, true);

      // A wrong password on the relocked (freshly re-encrypted) state is
      // still rejected — locking doesn't weaken the credential check.
      q<HTMLInputElement>('#master-password').value = 'not the right password';
      dispatch(q('#unlock-form'), 'submit');
      await waitFor(() => q<HTMLButtonElement>('#unlock-btn').disabled === false);
      assert.equal(q<HTMLElement>('#unlock-error').hidden, false);

      // The same password and key file the database was originally opened
      // with unlocks it again.
      q<HTMLInputElement>('#master-password').value = PASSWORD;
      const keyfileInput = q<HTMLInputElement>('#keyfile-input');
      setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
      dispatch(keyfileInput, 'change');
      await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
      dispatch(q('#unlock-form'), 'submit');
      await waitFor(() => dom.window.document.body.classList.contains('app-mode'), 15000);

      // The "Personal" group created earlier in this walkthrough only
      // exists in the edited, never-downloaded state — finding it here
      // proves locking preserved the in-memory edits instead of reverting
      // to the originally-uploaded bytes.
      const groupNames = Array.from(
        q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'),
      ).map((b) => b.textContent);
      assert.ok(groupNames.some((name) => name?.includes('Personal')));

      // The edit was only ever re-encrypted into memory, never actually
      // saved anywhere — re-unlocking must not quietly forget that.
      assert.equal(
        q<HTMLButtonElement>('[data-action="save-database"]').disabled,
        false,
        'still unsaved after a lock that chose not to save',
      );
    },
  );

  await t.test(
    'locking can save first instead: choosing Download saves, then locks, and the edit counts as saved from then on',
    async () => {
      // Nothing of the app's is on the clipboard, so locking leaves it alone (#88).
      clipboardText = 'copied in another app';

      q('[data-action="lock"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const lockDlg = byId<HTMLDialogElement>('dlg-confirm-discard');
      assert.equal(lockDlg.open, true);

      dq('[data-action="confirm-save"]').dispatchEvent(
        new dom.window.Event('click', { bubbles: true }),
      );
      await waitFor(() => lockDlg.open === false);
      await waitFor(() => q('#master-password') !== null);
      assert.equal(clipboardText, 'copied in another app');

      q<HTMLInputElement>('#master-password').value = PASSWORD;
      const keyfileInput = q<HTMLInputElement>('#keyfile-input');
      setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
      dispatch(keyfileInput, 'change');
      await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
      dispatch(q('#unlock-form'), 'submit');
      await waitFor(() => dom.window.document.body.classList.contains('app-mode'), 15000);

      assert.equal(
        q<HTMLButtonElement>('[data-action="save-database"]').disabled,
        true,
        'saving before locking clears the unsaved indicator',
      );
    },
  );

  await t.test('closing a saved database still asks, and cancelling leaves it open', () => {
    q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    const dlg = byId<HTMLDialogElement>('dlg-confirm-discard');
    assert.equal(
      dlg.open,
      true,
      'nothing is unsaved, but the open database is still worth a question',
    );
    assert.equal(byId<HTMLElement>('confirm-discard-title').textContent, 'Close this database?');
    const confirmBtn = dq<HTMLButtonElement>(
      '#dlg-confirm-discard [data-action="confirm-discard"]',
    );
    assert.equal(confirmBtn.textContent, 'Close');
    assert.equal(confirmBtn.className, 'btn btn-primary', 'the only affirmative action here');
    assert.equal(
      dq<HTMLButtonElement>('#dlg-confirm-discard [data-action="confirm-save"]').hidden,
      true,
      'nothing to save, so no Save button',
    );

    dq('#dlg-confirm-discard [data-action="cancel-discard"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);
    assert.ok(dom.window.document.body.classList.contains('app-mode'), 'still open');
  });

  await t.test('confirming the close returns to the upload screen and clears the tab', () => {
    q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.ok(q('#drop-zone'));
    assert.equal(dom.window.document.body.classList.contains('app-mode'), false);
    assert.equal(dom.window.document.title, 'KeePass Web');
  });
});

test('closing with unsaved changes prompts to discard, and confirming discards them', async () => {
  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('close-test.kdbx', dbBytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);

  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  // Make an unsaved edit, then return to the entry list (the close button
  // lives in its header, not the detail screen the save dialog leaves us on).
  q('[data-action="add-entry"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-save [data-action="close"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  let dlg = byId<HTMLDialogElement>('dlg-confirm-discard');
  assert.equal(dlg.open, true);
  dq('#dlg-confirm-discard [data-action="cancel-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  assert.equal(dlg.open, false);
  assert.ok(q('#group-tree'), 'cancelling keeps the database open');

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dlg = byId<HTMLDialogElement>('dlg-confirm-discard');
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  assert.equal(dlg.open, false);
  assert.ok(q('#drop-zone'), 'confirming discard returns to the upload screen');
});

test('beforeunload is blocked for as long as this tab holds a database', async () => {
  const fireBeforeUnload = (): Event => dispatch(dom.window, 'beforeunload');
  assert.equal(
    fireBeforeUnload().defaultPrevented,
    false,
    'an empty tab has nothing to lose, so it closes freely',
  );

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('beforeunload-test.kdbx', dbBytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);

  assert.equal(
    fireBeforeUnload().defaultPrevented,
    true,
    'the file is in the tab already; finding it again would cost what it cost the first time',
  );

  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  assert.equal(fireBeforeUnload().defaultPrevented, true, 'an unlocked database blocks the unload');

  q('[data-action="add-entry"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(fireBeforeUnload().defaultPrevented, true, 'and so does an unsaved edit');

  // Return to the entry list (the close button lives in its header, not the
  // entry-edit screen add-entry leaves us on — same recovery as the test
  // above), then discard, leaving the app back on the upload screen as every
  // other test here expects.
  q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-save [data-action="close"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  assert.ok(q('#drop-zone'));
  assert.equal(
    fireBeforeUnload().defaultPrevented,
    false,
    'a closed database lets the tab go again',
  );
});

/** jsdom's visibilityState is a read-only getter, so it is redefined on the
 * document instance; the app reads document.visibilityState and listens for
 * the event, which is exactly what a real tab switch produces. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(dom.window.document, 'visibilityState', {
    value: state,
    configurable: true,
  });
  dispatch(dom.window.document, 'visibilitychange');
}

test('idle hides the page behind a curtain, then locks it', async (t) => {
  async function unlock(): Promise<void> {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    const keyfileInput = q<HTMLInputElement>('#keyfile-input');
    setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
    dispatch(keyfileInput, 'change');
    await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
    dispatch(q('#unlock-form'), 'submit');
    await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
  }
  function setDelays(curtainSeconds: string, lockSeconds: string): void {
    dispatch(q('[data-action="settings"]'), 'click');
    byId<HTMLInputElement>('curtain-timeout').value = curtainSeconds;
    byId<HTMLInputElement>('auto-lock-timeout').value = lockSeconds;
    dispatch(dq('#dlg-settings [data-action="save-settings"]'), 'click');
  }
  /* Only Date is mocked, so the page's own timers stay real and long; coming
  back to the tab is what makes it look at the clock, as a late background
  wake would. */
  function idleFor(ms: number): void {
    t.mock.timers.tick(ms);
    setVisibility('visible');
  }

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('idle.kdbx', dbBytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  await unlock();

  const curtain = byId<HTMLDialogElement>('dlg-curtain');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  setDelays('60', '300');

  // Any input starts the idle count over.
  idleFor(59_000);
  assert.equal(curtain.open, false);
  dispatch(dom.window, 'keydown');
  idleFor(59_000);
  assert.equal(curtain.open, false, 'the keystroke reset the count');
  idleFor(1_000);
  assert.equal(curtain.open, true, 'a minute idle brings the curtain down');
  dispatch(curtain.querySelector('button') as HTMLButtonElement, 'click');

  // Scrolling counts, as reading a long list on a phone sends nothing else.
  idleFor(59_000);
  dispatch(dom.window, 'scroll');
  idleFor(59_000);
  assert.equal(curtain.open, false, 'the scroll reset the count');
  idleFor(1_000);
  assert.equal(curtain.open, true);

  // Behind the curtain, only lifting it counts as being back.
  dispatch(dom.window, 'pointermove');
  idleFor(239_000);
  assert.equal(curtain.open, true, 'still down, and still unlocked');
  assert.ok(dom.window.document.body.classList.contains('app-mode'));
  dispatch(curtain.querySelector('button') as HTMLButtonElement, 'click');
  assert.equal(curtain.open, false, 'a click lifts it');

  // Escape lifts it too, and restarts the count just the same.
  idleFor(299_000);
  assert.equal(curtain.open, true);
  dispatch(curtain, 'cancel');
  assert.equal(curtain.open, false);

  // Five minutes idle locks, with nothing to confirm. Re-encrypting takes a
  // moment, and the curtain stays down through it rather than show the page.
  const realSave = Kdbx.prototype.save;
  let saves = 0;
  Kdbx.prototype.save = function (this: Kdbx, ...args: Parameters<Kdbx['save']>) {
    saves++;
    return realSave.apply(this, args);
  };
  try {
    idleFor(60_000);
    assert.equal(curtain.open, true);
    idleFor(240_000);
    assert.equal(curtain.open, true, 'still down while the lock is under way');
    dispatch(curtain.querySelector('button') as HTMLButtonElement, 'click');
    assert.equal(curtain.open, true, 'and a click cannot lift it part way');
    setVisibility('visible');
    dispatch(q('[data-action="lock"]'), 'click');
    await waitFor(() => q('#master-password') !== null);
  } finally {
    Kdbx.prototype.save = realSave;
  }
  assert.equal(saves, 1, 'neither coming back nor the lock button started a second lock');
  assert.equal(curtain.open, false, 'the curtain goes once the unlock screen is up');
  assert.equal(
    dom.window.document.title,
    'idle.kdbx - Locked - KeePass Web',
    'the tab bar says so without being opened',
  );

  // Locked, there is nothing left to watch.
  idleFor(600_000);
  setVisibility('hidden');
  assert.ok(q('#master-password'), 'no second lock attempted');
  setVisibility('visible');

  // A lock due no later than the curtain leaves the curtain out entirely.
  await unlock();
  setDelays('120', '60');
  idleFor(59_000);
  assert.equal(curtain.open, false);
  idleFor(1_000);
  await waitFor(() => q('#master-password') !== null);
  assert.equal(curtain.open, false, 'locked without a curtain first');

  t.mock.timers.reset();
  dispatch(q('[data-action="back"]'), 'click');
  assert.ok(q('#drop-zone'));
});

// ============================================================
// Edge cases: closing genuinely reachable defensive branches
// ============================================================

test('a rejection that is not an Error instance still shows a fallback message', async () => {
  // Kdbx.load always rejects with a real Error in practice; the
  // `err instanceof Error` guard exists for whatever might not (a rejected
  // value from somewhere else entirely). Kdbx is hoisted onto globalThis by
  // reference (see the harness setup above), so patching this static method
  // here affects page.ts's own `await Kdbx.load(...)` call the same way.
  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('again2.kdbx', dbBytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);

  const realLoad = Kdbx.load;
  Kdbx.load = () => Promise.reject('a plain string rejection, not an Error');
  try {
    q<HTMLInputElement>('#master-password').value = 'irrelevant';
    dispatch(q('#unlock-form'), 'submit');
    await waitFor(() => q<HTMLElement>('#unlock-error').hidden === false);
  } finally {
    Kdbx.load = realLoad;
  }
  assert.equal(
    q<HTMLElement>('#unlock-error').textContent,
    'Incorrect credentials or corrupt file.',
  );

  // Leave the app back on the upload screen, which the next test assumes.
  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
});

test('create-database: an Error thrown by Kdbx.create is shown as-is', async () => {
  q('[data-action="create-database"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  const realCreate = Kdbx.create;
  Kdbx.create = () => Promise.reject(new Error('simulated creation failure'));
  try {
    q<HTMLInputElement>('#create-password').value = 'x';
    q<HTMLInputElement>('#create-password-confirm').value = 'x';
    dispatch(q('#create-form'), 'submit');
    await waitFor(() => q<HTMLElement>('#create-error').hidden === false);
  } finally {
    Kdbx.create = realCreate;
  }
  assert.equal(q<HTMLElement>('#create-error').textContent, 'simulated creation failure');
  assert.equal(q<HTMLButtonElement>('#create-btn').disabled, false);
  assert.equal(q<HTMLButtonElement>('#create-btn').textContent, 'Create');

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
});

test('create-database: a non-Error rejection shows a fallback message, and a blank name falls back to "Database"', async () => {
  q('[data-action="create-database"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  const realCreate = Kdbx.create;
  let receivedName: string | undefined;
  Kdbx.create = (_credentials: Credentials, options?: { databaseName?: string }) => {
    receivedName = options?.databaseName;
    return Promise.reject('a plain string rejection, not an Error');
  };
  try {
    q<HTMLInputElement>('#create-name').value = '   ';
    q<HTMLInputElement>('#create-password').value = 'x';
    q<HTMLInputElement>('#create-password-confirm').value = 'x';
    dispatch(q('#create-form'), 'submit');
    await waitFor(() => q<HTMLElement>('#create-error').hidden === false);
  } finally {
    Kdbx.create = realCreate;
  }
  assert.equal(q<HTMLElement>('#create-error').textContent, 'Could not create database.');
  assert.equal(receivedName, 'Database');

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
});

test('an entry with Expires=True but no ExpiryTime, and no CreationTime either (a malformed/external file), shows no Expires line, a dash for Created, and an empty enabled datetime input', async () => {
  // Real KeePass always writes these Times fields, but this app must not
  // choke on a file where that's not true — same rationale as the "URL
  // Only" malformed-<String> fixture in buildTestDatabase() above.
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const rootGroup = kdbx.getRootGroup();
  const entry = createEntry({ title: 'Expires No Time' });
  const times = getChild(entry, 'Times') as XmlElement;
  setText(getChild(times, 'Expires') as XmlElement, 'True');
  times.children = times.children.filter(
    (c) => !(c.type === 'element' && (c.name === 'ExpiryTime' || c.name === 'CreationTime')),
  );
  appendChild(rootGroup, entry);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('expiry-edge-case.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  (q('.entry-row') as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const meta = q<HTMLElement>('#detail-meta').textContent ?? '';
  assert.doesNotMatch(meta, /Expires/);
  assert.match(meta, /Created —/);

  q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(q<HTMLInputElement>('#edit-expires').checked, true);
  assert.equal(q<HTMLInputElement>('#edit-expiry-time').value, '');
  assert.equal(q<HTMLInputElement>('#edit-expiry-time').disabled, false);

  // Leave the app back on the upload screen, which the next test assumes.
  q('[data-action="cancel"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('attachments can be added, shown, and survive save/reload on KDBX 3.1 files', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, { version: 3, aesKdfRounds: 1000n });
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'V3 Entry' }));
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('v3.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  (q('.entry-row') as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(q('#detail-attachments').children.length, 0);

  q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const attachmentInput = q<HTMLInputElement>('#edit-attachment-input');
  setFiles(attachmentInput, [makeFile('v3-notes.txt', new TextEncoder().encode('hello 3.1'))]);
  dispatch(attachmentInput, 'change');
  await waitFor(() => q('#edit-attachments').children.length === 1);
  assert.equal(q<HTMLInputElement>('.attachment-name').value, 'v3-notes.txt');

  q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const detailRow = q('#detail-attachments .attachment-row');
  assert.ok(detailRow, 'the attachment shows on the detail screen too');
  assert.equal(detailRow.querySelector('.attachment-name')?.textContent, 'v3-notes.txt');
  dq('#dlg-save [data-action="close"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('an empty password box opens a key-file-only database, and one keyed with an empty password too (#127)', async () => {
  const unlockWithKeyFileOnly = async (credentials: Credentials, keyFile: Uint8Array) => {
    const kdbx = await Kdbx.create(credentials, {
      version: 4,
      cipher: 'chacha20',
      kdf: 'argon2id',
      argon2: FAST_ARGON2,
      aesKdfRounds: 1000n,
    });
    appendChild(kdbx.getRootGroup(), createEntry({ title: 'Behind a key file' }));
    const fileInput = q<HTMLInputElement>('#file-input');
    setFiles(fileInput, [makeFile('key-only.kdbx', await kdbx.save())]);
    dispatch(fileInput, 'change');
    await waitFor(() => q('#master-password') !== null);
    const keyfileInput = q<HTMLInputElement>('#keyfile-input');
    setFiles(keyfileInput, [makeFile('keyfile.bin', keyFile)]);
    dispatch(keyfileInput, 'change');
    await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
    dispatch(q('#unlock-form'), 'submit');
  };
  const closeDatabase = () => {
    q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.ok(q('#drop-zone'));
  };

  // KeePass and KeePassXC both make databases keyed by a key file alone.
  await unlockWithKeyFileOnly(new Credentials({ keyFile: KEYFILE }), KEYFILE);
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
  assert.ok(q('.entry-row'), 'unlocked with the password box left empty');
  closeDatabase();

  // An empty password with a key file is a different key, and still opens.
  await unlockWithKeyFileOnly(new Credentials({ password: '', keyFile: KEYFILE }), KEYFILE);
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
  assert.ok(q('.entry-row'), 'unlocked after the key-file-alone attempt failed');
  closeDatabase();

  // A wrong key file fails both attempts and says so.
  await unlockWithKeyFileOnly(
    new Credentials({ keyFile: KEYFILE }),
    KEYFILE.map((b) => b ^ 1),
  );
  await waitFor(() => q<HTMLElement>('#unlock-error').hidden === false);
  assert.match(q<HTMLElement>('#unlock-error').textContent ?? '', /wrong credentials/);
  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.ok(q('#drop-zone'));
});

test('a stale attachment Ref (pointing to no pool data) is shown but downloading it is a no-op, not a throw', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const entry = createEntry({ title: 'Stale Attachment' });
  addEntryAttachment(entry, 'ghost.txt', 999);
  appendChild(kdbx.getRootGroup(), entry);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('stale-ref.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  (q('.entry-row') as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const row = q('#detail-attachments .attachment-row');
  assert.ok(row, 'the attachment still shows even though its data is missing');
  q<HTMLButtonElement>('[title="Download"]').click(); // must not throw

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test("Save keeps every field's line breaks, touched or not, and masks a protected multi-line value (#126)", async () => {
  // KeePass and KeePassXC edit custom fields in multi-line boxes, so an SSH key
  // or an address written there must survive an edit here that never touched it.
  const sshKey = '-----BEGIN KEY-----\nAAAA\nBBBB\n-----END KEY-----';
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const entry = createEntry({
    title: 'Server\nwest', // a line break where KeePass offers one line still has to survive
    username: 'admin',
    notes: 'one line',
    fields: [
      { key: 'Address', value: '1 Main St\nSpringfield' },
      { key: 'SSH key', value: sshKey, protect: true },
      { key: 'PIN', value: '1234' },
    ],
  });
  appendChild(kdbx.getRootGroup(), entry);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('multiline.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  (q('.entry-row') as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const editRow = (key: string): HTMLElement =>
    Array.from(root().querySelectorAll<HTMLElement>('.edit-field')).find(
      (row) => row.querySelector<HTMLInputElement>('.edit-key')?.value === key,
    ) as HTMLElement;
  const valueBox = (key: string) =>
    editRow(key).querySelector('.edit-value') as HTMLInputElement | HTMLTextAreaElement;

  // The standard single-line fields stay inputs; Notes and custom fields take lines,
  // and so does any field whose value already holds a line break.
  assert.equal(valueBox('UserName').tagName, 'INPUT');
  assert.equal(valueBox('Title').tagName, 'TEXTAREA');
  assert.equal(valueBox('Title').getAttribute('rows'), '2');
  assert.equal(valueBox('Password').tagName, 'INPUT');
  assert.equal(valueBox('Password').getAttribute('type'), 'password');
  assert.equal(valueBox('Notes').tagName, 'TEXTAREA');
  assert.equal(valueBox('Notes').getAttribute('rows'), '5', 'Notes opens with room to write');
  assert.equal(valueBox('Address').tagName, 'TEXTAREA');
  assert.equal(valueBox('Address').getAttribute('rows'), '2', 'as tall as its value');
  assert.equal(valueBox('PIN').tagName, 'TEXTAREA');
  assert.equal(valueBox('PIN').getAttribute('rows'), '1');

  // A protected multi-line value is masked, and kept from spell checkers, like a password input.
  const sshValue = valueBox('SSH key') as HTMLTextAreaElement;
  assert.equal(sshValue.tagName, 'TEXTAREA');
  assert.equal(sshValue.value, sshKey);
  assert.equal(sshValue.classList.contains('concealed'), true);
  assert.equal(sshValue.getAttribute('spellcheck'), 'false');
  assert.equal(sshValue.getAttribute('autocapitalize'), 'off');
  assert.equal(sshValue.getAttribute('autocorrect'), 'off');
  assert.equal(valueBox('Address').hasAttribute('spellcheck'), false, 'unprotected, left as is');
  const reveal = editRow('SSH key').querySelector<HTMLButtonElement>(
    '[title="Show / hide"]',
  ) as HTMLButtonElement;
  reveal.click();
  assert.equal(sshValue.classList.contains('concealed'), false);
  assert.equal(iconOf(reveal), '#icon-eye-off');
  assert.equal(
    dom.window.document.activeElement,
    sshValue,
    'revealing puts the caret there (#110)',
  );
  reveal.click();
  assert.equal(sshValue.classList.contains('concealed'), true);
  assert.equal(iconOf(reveal), '#icon-eye');

  // Saved without touching anything: every line break is still there.
  q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-save [data-action="close"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  const detailValue = (key: string): string =>
    Array.from(root().querySelectorAll('.detail-field'))
      .find((row) => row.querySelector('.detail-label')?.textContent === key)
      ?.querySelector('.detail-value')?.textContent ?? '';
  assert.equal(detailValue('Title'), 'Server\nwest');
  assert.equal(detailValue('Address'), '1 Main St\nSpringfield');
  const sshDetail = Array.from(root().querySelectorAll<HTMLElement>('.detail-field')).find(
    (row) => row.querySelector('.detail-label')?.textContent === 'SSH key',
  ) as HTMLElement;
  sshDetail.querySelector<HTMLButtonElement>('[title="Show / hide"]')?.click();
  assert.equal(detailValue('SSH key'), sshKey);

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('with the database bin turned off, deleting is permanent and confirmed, and no bin appears (#132)', async () => {
  // KeePass and KeePassXC delete outright when a database has its bin off.
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Binless',
  });
  const meta = getChild(kdbx.root, 'Meta') as XmlElement;
  setText(getChild(meta, 'RecycleBinEnabled') as XmlElement, 'False');
  const doomedGroup = createGroup('Doomed Group');
  appendChild(doomedGroup, createEntry({ title: 'Inner Entry' }));
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'Doomed Entry' }));
  appendChild(kdbx.getRootGroup(), doomedGroup);

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('binless.kdbx', await kdbx.save())]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: EventTarget): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const groupButtons = (): HTMLButtonElement[] =>
    Array.from(q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn'));

  // An entry offers only a confirmed, permanent Delete.
  click(q('.entry-row'));
  assert.equal(q<HTMLButtonElement>('[data-action="trash"]').hidden, true);
  assert.equal(q<HTMLButtonElement>('[data-action="restore"]').hidden, true);
  assert.equal(q<HTMLButtonElement>('[data-action="delete"]').hidden, false);
  click(q('[data-action="delete"]'));
  assert.equal(byId<HTMLElement>('confirm-delete-title').textContent, 'Delete entry?');
  click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));

  // So does a group, and the entries in it go with it.
  click(groupButtons().find((b) => b.textContent?.endsWith('Doomed Group')) as HTMLButtonElement);
  click(q('[data-action="delete-group"]'));
  assert.equal(byId<HTMLElement>('confirm-delete-title').textContent, 'Delete group?');
  click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));
  assert.ok(!groupButtons().some((b) => b.textContent?.endsWith('Recycle Bin')), 'no bin was made');

  const downloads: Blob[] = [];
  const realCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    downloads.push(obj as Blob);
    return realCreate(obj);
  };
  try {
    click(q('[data-action="save-database"]'));
    click(dq('#dlg-save [data-action="download"]'));
    await waitFor(() => downloads.length === 1);
  } finally {
    URL.createObjectURL = realCreate;
  }
  const saved = await Kdbx.load(
    new Uint8Array(await (downloads[0] as Blob).arrayBuffer()),
    credentials,
  );
  assert.equal(getChild(getChild(saved.root, 'Meta') as XmlElement, 'RecycleBinUUID'), undefined);
  assert.deepEqual(getChildren(saved.getRootGroup(), 'Entry'), []);
  assert.deepEqual(getChildren(saved.getRootGroup(), 'Group'), []);
  const deleted = getChild(getChild(saved.root, 'Root') as XmlElement, 'DeletedObjects');
  assert.equal(getChildren(deleted as XmlElement, 'DeletedObject').length, 3);

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('Save with nothing changed leaves the entry, its History and the database untouched (#134)', async () => {
  // A copy in History and a newer time for nothing would make this stale
  // version win a merge in KeePass or KeePassXC over a real edit made there.
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const entry = createEntry({ title: 'Untouched', notes: 'line one\r\nline two' });
  // Tags as KeePassXC writes them, which the form would rewrite with semicolons.
  appendChild(entry, createElement('Tags', 'Finance,Personal'));
  const times = getChild(entry, 'Times') as XmlElement;
  setText(getChild(times, 'LastModificationTime') as XmlElement, '2001-02-03T04:05:06Z');
  appendChild(kdbx.getRootGroup(), entry);

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('untouched.kdbx', await kdbx.save())]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: EventTarget): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const historyRows = (): number => q('#detail-history').querySelectorAll('.history-row').length;
  click(q('.entry-row'));
  const metaBefore = q<HTMLElement>('#detail-meta').textContent;
  assert.match(metaBefore ?? '', /2001/, 'the card shows the old modification time');

  click(q('[data-action="edit"]'));
  click(q('[data-action="save"]'));
  assert.ok(q('#detail-title'), 'back on the card');
  assert.equal(byId<HTMLDialogElement>('dlg-save').open, false, 'nothing to save');
  assert.equal(historyRows(), 0, 'no History copy');
  assert.equal(q<HTMLElement>('#detail-meta').textContent, metaBefore, 'no newer time');

  // A real change still goes through, with its History copy.
  click(q('[data-action="edit"]'));
  q<HTMLInputElement>('.edit-value').value = 'Touched';
  click(q('[data-action="save"]'));
  assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);
  assert.equal(historyRows(), 1);
  click(dq('#dlg-save [data-action="close"]'));

  click(q('[data-action="back"]'));
  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

test('a database stays unmarked when an entry is saved unchanged (#134)', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'Clean' }));

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('clean.kdbx', await kdbx.save())]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: EventTarget): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  click(q('.entry-row'));
  click(q('[data-action="edit"]'));
  click(q('[data-action="save"]'));
  click(q('[data-action="back"]'));
  assert.equal(q<HTMLButtonElement>('[data-action="save-database"]').disabled, true);

  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

test('restoring from the bin returns an entry or group to the group it came from, or the top once that is gone (#133)', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Vault',
  });
  const work = createGroup('Work');
  const projects = createGroup('Projects');
  appendChild(work, createEntry({ title: 'Laptop' }));
  appendChild(work, projects);
  appendChild(kdbx.getRootGroup(), work);

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('restore.kdbx', await kdbx.save())]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: EventTarget): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const groupBtnFor = (name: string): HTMLButtonElement =>
    Array.from(q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn')).find((b) =>
      b.textContent?.endsWith(name),
    ) as HTMLButtonElement;
  const entryTitles = (): string[] =>
    Array.from(root().querySelectorAll('.entry-row-title'), (t) => t.textContent ?? '');
  const parentNameOf = (name: string): string =>
    groupBtnFor(name)
      .closest('li')
      ?.parentElement?.closest('li')
      ?.querySelector('.group-btn')
      ?.textContent?.trim() ?? '';

  // An entry trashed from Work goes back to Work.
  click(groupBtnFor('Work'));
  click(q('.entry-row'));
  click(q('[data-action="trash"]'));
  click(groupBtnFor('Recycle Bin'));
  click(q('.entry-row'));
  click(q('[data-action="restore"]'));
  click(groupBtnFor('Work'));
  assert.deepEqual(
    entryTitles().map((t) => t.trim()),
    ['Laptop'],
  );

  // So does a group, undeleted from its menu.
  click(groupBtnFor('Projects'));
  click(q('[data-action="delete-group"]'));
  click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));
  assert.match(parentNameOf('Projects'), /Recycle Bin$/);
  click(groupBtnFor('Projects'));
  click(groupBtnFor('Projects').closest('.group-row')?.querySelector('.group-menu-btn') as Element);
  click(
    Array.from(
      (groupBtnFor('Projects').closest('li') as HTMLElement).querySelectorAll<HTMLButtonElement>(
        ':scope > .group-menu .group-menu-item',
      ),
    ).find((b) => b.textContent === 'Undelete') as HTMLButtonElement,
  );
  assert.match(parentNameOf('Projects'), /Work$/);

  // Once the group they came from is in the bin itself, both go to the top.
  click(groupBtnFor('Work'));
  click(q('.entry-row'));
  click(q('[data-action="trash"]'));
  click(groupBtnFor('Projects'));
  click(q('[data-action="delete-group"]'));
  click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));
  click(groupBtnFor('Work'));
  click(q('[data-action="delete-group"]'));
  click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));
  click(groupBtnFor('Recycle Bin'));
  click(
    Array.from(root().querySelectorAll<HTMLElement>('.entry-row')).find((r) =>
      r.querySelector('.entry-row-title')?.textContent?.includes('Laptop'),
    ) as HTMLElement,
  );
  click(q('[data-action="restore"]'));
  click(groupBtnFor('Vault'));
  assert.ok(
    entryTitles().some((t) => t.includes('Laptop')),
    'the entry is at the top',
  );
  click(groupBtnFor('Projects'));
  click(groupBtnFor('Projects').closest('.group-row')?.querySelector('.group-menu-btn') as Element);
  click(
    Array.from(
      (groupBtnFor('Projects').closest('li') as HTMLElement).querySelectorAll<HTMLButtonElement>(
        ':scope > .group-menu .group-menu-item',
      ),
    ).find((b) => b.textContent === 'Undelete') as HTMLButtonElement,
  );
  assert.match(parentNameOf('Projects'), /Vault$/, 'and so is the group');

  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

test('entry history: edits are snapshotted, and a past version can be restored or deleted', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'v1' }));
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('history.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const historyRows = (): HTMLElement[] =>
    Array.from(q('#detail-history').querySelectorAll<HTMLElement>('.history-row'));
  const editTitleTo = (title: string): void => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    q<HTMLInputElement>('.edit-value').value = title; // first .edit-value is Title
    q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    dq('#dlg-save [data-action="close"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
  };

  (q('.entry-row') as HTMLElement).dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(historyRows().length, 0, 'no history on an untouched entry');

  editTitleTo('v2');
  assert.equal(historyRows().length, 1, 'editing an existing entry snapshots its pre-edit state');
  assert.ok(
    (historyRows()[0] as HTMLElement).querySelector('.history-label')?.textContent?.includes('v1'),
  );

  editTitleTo('v3');
  // Just asserted length 2/3 above each time, so these indices are always present.
  const rowsAfterTwoEdits = historyRows();
  assert.equal(rowsAfterTwoEdits.length, 2);
  const [newer, older] = rowsAfterTwoEdits as [HTMLElement, HTMLElement];
  // Newest snapshot first.
  assert.ok(newer.querySelector('.history-label')?.textContent?.includes('v2'));
  assert.ok(older.querySelector('.history-label')?.textContent?.includes('v1'));

  // Restore the older ("v1") snapshot.
  older
    .querySelector<HTMLButtonElement>('[title="Restore this version"]')
    ?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.ok(
    q<HTMLElement>('#detail-title').textContent?.includes('v1'),
    'adopts the restored title',
  );
  const rowsAfterRestore = historyRows();
  assert.equal(
    rowsAfterRestore.length,
    3,
    'restoring itself snapshots the pre-restore ("v3") state',
  );
  const [newest] = rowsAfterRestore as [HTMLElement];
  assert.ok(newest.querySelector('.history-label')?.textContent?.includes('v3'));

  // Delete one snapshot.
  newest
    .querySelector<HTMLButtonElement>('[title="Delete this version"]')
    ?.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(historyRows().length, 2);

  q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  // The edits above left the database dirty, so closing needs confirmation.
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

// They wait for Save like every other edit, so History keeps the version before them (#109).
test('icon and attachment edits apply on Save, after the History snapshot, and Cancel discards them', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const entry = createEntry({ title: 'Passport' });
  addEntryAttachment(entry, 'scan.pdf', kdbx.addBinary(new TextEncoder().encode('scan')));
  addEntryAttachment(entry, 'photo.jpg', kdbx.addBinary(new TextEncoder().encode('photo')));
  appendChild(kdbx.getRootGroup(), entry);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('held-edits.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: Element): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const editNameInputs = (): HTMLInputElement[] =>
    Array.from(root().querySelectorAll<HTMLInputElement>('#edit-attachments .attachment-name'));
  const detailNames = (): string[] =>
    Array.from(root().querySelectorAll('#detail-attachments .attachment-name')).map(
      (el) => el.textContent ?? '',
    );
  // Opens the edit screen, picks Bank, renames one attachment, removes another and adds a third.
  const editIconAndAttachments = async (): Promise<void> => {
    click(q('[data-action="edit"]'));
    click(q('#edit-icon-btn'));
    const bank = Array.from(
      byId<HTMLElement>('icon-grid').querySelectorAll<HTMLButtonElement>('.icon-grid-btn'),
    ).find((b) => b.title === 'Bank') as HTMLButtonElement;
    click(bank);

    const scan = editNameInputs().find((input) => input.value === 'scan.pdf') as HTMLInputElement;
    scan.value = 'passport.pdf';
    dispatch(scan, 'change');
    const photo = editNameInputs().find((input) => input.value === 'photo.jpg') as HTMLElement;
    click(
      photo.closest('.attachment-row')?.querySelector('[title="Remove attachment"]') as Element,
    );
    const attachmentInput = q<HTMLInputElement>('#edit-attachment-input');
    setFiles(attachmentInput, [makeFile('visa.pdf', new TextEncoder().encode('visa'))]);
    dispatch(attachmentInput, 'change');
    await waitFor(() => editNameInputs().length === 2);

    assert.equal(iconOf(q('#edit-icon-btn')), '#icon-bank');
    assert.deepEqual(
      editNameInputs().map((input) => input.value),
      ['passport.pdf', 'visa.pdf'],
    );
  };

  click(q('.entry-row'));
  await editIconAndAttachments();
  click(q('[data-action="cancel"]'));
  assert.equal(iconOf(q('#detail-title')), '#icon-key', 'Cancel keeps the icon');
  assert.equal(q<HTMLElement>('#detail-title').textContent, 'Passport');
  assert.deepEqual(detailNames(), ['scan.pdf', 'photo.jpg'], 'Cancel keeps the attachments');
  click(q('[data-action="back"]'));
  assert.equal(
    q<HTMLButtonElement>('[data-action="save-database"]').disabled,
    true,
    'Cancel leaves nothing unsaved',
  );

  click(q('.entry-row'));
  await editIconAndAttachments();
  click(q('[data-action="save"]'));
  assert.equal(iconOf(q('#detail-title')), '#icon-bank');
  assert.deepEqual(detailNames(), ['passport.pdf', 'visa.pdf']);
  click(dq('#dlg-save [data-action="close"]'));

  // The snapshot Save took is the entry before this edit, so restoring it brings both back.
  click(q('#detail-history [title="Restore this version"]'));
  assert.equal(iconOf(q('#detail-title')), '#icon-key');
  assert.deepEqual(detailNames(), ['scan.pdf', 'photo.jpg']);

  click(q('[data-action="back"]'));
  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

// KeePass and KeePassXC keep an entry's attachments by name, so they show one of the pair and lose the other (#120).
test('Save refuses two attachments of one name, attached or renamed so, until one is renamed', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const entry = createEntry({ title: 'Passport' });
  addEntryAttachment(entry, 'scan.pdf', kdbx.addBinary(new TextEncoder().encode('scan')));
  addEntryAttachment(entry, 'photo.jpg', kdbx.addBinary(new TextEncoder().encode('photo')));
  appendChild(kdbx.getRootGroup(), entry);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('same-names.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: Element): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const nameInputs = (): HTMLInputElement[] =>
    Array.from(root().querySelectorAll<HTMLInputElement>('#edit-attachments .attachment-name'));
  const rename = (index: number, name: string): void => {
    const input = nameInputs()[index] as HTMLInputElement;
    input.value = name;
    dispatch(input, 'change');
  };
  const historyRows = () => q('#detail-history').querySelectorAll('.history-row').length;

  click(q('.entry-row'));
  const historyBefore = historyRows();
  click(q('[data-action="edit"]'));
  const fieldError = q<HTMLElement>('#edit-error');
  const attachmentError = q<HTMLElement>('#edit-attachments-error');
  assert.equal(attachmentError.hidden, true);

  const attachmentInput = q<HTMLInputElement>('#edit-attachment-input');
  setFiles(attachmentInput, [makeFile('scan.pdf', new TextEncoder().encode('rescan'))]);
  dispatch(attachmentInput, 'change');
  await waitFor(() => nameInputs().length === 3);
  // A field clash too, so both reasons show and the first on the screen is focused.
  click(q('[data-action="add-field"]'));
  const keys = root().querySelectorAll<HTMLInputElement>('.edit-key');
  const addedKey = keys[keys.length - 1] as HTMLInputElement;
  addedKey.value = 'Title';

  click(q('[data-action="save"]'));
  assert.equal(fieldError.hidden, false);
  assert.equal(attachmentError.hidden, false);
  assert.equal(
    attachmentError.textContent,
    'More than one attachment is named "scan.pdf". Rename or remove one, then save.',
  );
  assert.equal(dom.window.document.activeElement, addedKey);

  addedKey.value = 'Passport number';
  click(q('[data-action="save"]'));
  assert.equal(fieldError.hidden, true, 'a reason since fixed goes away');
  assert.equal(attachmentError.hidden, false);
  assert.equal(dom.window.document.activeElement, nameInputs()[2], 'the one just attached');

  rename(2, 'photo.jpg');
  click(q('[data-action="save"]'));
  assert.equal(
    attachmentError.textContent,
    'More than one attachment is named "photo.jpg". Rename or remove one, then save.',
  );
  assert.equal(dom.window.document.activeElement, nameInputs()[2], 'the one just renamed');
  assert.ok(q('#edit-title'), 'still on the edit screen');
  assert.equal(byId<HTMLDialogElement>('dlg-save').open, false);

  rename(2, 'scan-2026.pdf');
  click(q('[data-action="save"]'));
  assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);
  assert.deepEqual(
    Array.from(root().querySelectorAll('#detail-attachments .attachment-name')).map(
      (el) => el.textContent,
    ),
    ['scan.pdf', 'photo.jpg', 'scan-2026.pdf'],
  );
  assert.equal(historyRows(), historyBefore + 1, 'only the save that went through kept History');
  click(dq('#dlg-save [data-action="close"]'));

  click(q('[data-action="back"]'));
  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

// A save drops attachment data nothing uses, which can move the rest while the card stays open (#119).
test("an open card's Download still fetches its own attachment after a save moves the stored data", async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  // Only First's History version holds old.txt, whose data is stored ahead of Second's keep.txt.
  const first = createEntry({ title: 'First' });
  addEntryAttachment(first, 'old.txt', kdbx.addBinary(new TextEncoder().encode('old')));
  pushHistorySnapshot(kdbx.root, first, kdbx.binaries);
  removeEntryAttachment(first, 'old.txt');
  const second = createEntry({ title: 'Second' });
  addEntryAttachment(second, 'keep.txt', kdbx.addBinary(new TextEncoder().encode('keep')));
  appendChild(kdbx.getRootGroup(), first);
  appendChild(kdbx.getRootGroup(), second);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('renumbered.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: Element): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const openEntryTitled = (title: string): void => {
    const rows = Array.from(root().querySelectorAll('.entry-row'));
    click(rows.find((row) => row.textContent?.includes(title)) as Element);
  };

  // Deleting First's History version leaves old.txt's data unused.
  openEntryTitled('First');
  click(q('#detail-history [title="Delete this version"]'));
  click(q('[data-action="back"]'));

  // Second's card is drawn by Save, and the save prompt over it drops old.txt's data, moving keep.txt's.
  openEntryTitled('Second');
  click(q('[data-action="edit"]'));
  click(q('[data-action="save"]'));
  click(dq('#dlg-save [data-action="download"]'));
  await waitFor(() => byId<HTMLDialogElement>('dlg-save').open === false);

  const downloaded: Blob[] = [];
  const realCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    downloaded.push(obj as Blob);
    return realCreate(obj);
  };
  try {
    click(q('#detail-attachments [title="Download"]'));
  } finally {
    URL.createObjectURL = realCreate;
  }
  assert.equal(downloaded.length, 1, 'the card still downloads its attachment');
  assert.equal(await (downloaded[0] as Blob).text(), 'keep');

  click(q('[data-action="back"]'));
  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

test('a rename, a move and permanent deletes reach the saved file as other KeePass clients merge them', async () => {
  // KeePass and KeePassXC merge two copies by these times and DeletedObjects
  // records, so they are checked in the bytes a save writes, not just in memory (#108).
  const LONG_AGO = '2000-01-01T00:00:00Z';
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'Merge Vault',
  });
  const rootGroup = kdbx.getRootGroup();
  const keep = createGroup('Keep');
  const mover = createEntry({ title: 'Mover' });
  appendChild(keep, mover);
  const doomedGroup = createGroup('Doomed Group');
  const doomedChild = createEntry({ title: 'Doomed Child' });
  appendChild(doomedGroup, doomedChild);
  const doomedEntry = createEntry({ title: 'Doomed Entry' });
  appendChild(rootGroup, doomedEntry);
  appendChild(rootGroup, keep);
  appendChild(rootGroup, doomedGroup);
  const timeEl = (element: XmlElement, name: string): XmlElement =>
    getChild(getChild(element, 'Times') as XmlElement, name) as XmlElement;
  for (const element of [keep, mover]) {
    setText(timeEl(element, 'LastModificationTime'), LONG_AGO);
    setText(timeEl(element, 'LocationChanged'), LONG_AGO);
  }
  const uuidOf = (element: XmlElement): string => getText(getChild(element, 'UUID') as XmlElement);
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('merge.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const click = (el: EventTarget): void => {
    el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  };
  const groupBtnFor = (name: string): HTMLButtonElement =>
    Array.from(q('#group-tree').querySelectorAll<HTMLButtonElement>('.group-btn')).find((b) =>
      b.textContent?.endsWith(name),
    ) as HTMLButtonElement;
  const openEntry = (title: string): void => {
    click(
      Array.from(root().querySelectorAll<HTMLElement>('.entry-row')).find((r) =>
        r.querySelector('.entry-row-title')?.textContent?.includes(title),
      ) as HTMLElement,
    );
  };
  const confirmDelete = (): void => click(dq('#dlg-confirm-delete [data-action="confirm-delete"]'));

  // Rename "Keep" from its row menu; the menu only shows on the active row.
  click(groupBtnFor('Keep'));
  click(groupBtnFor('Keep').closest('.group-row')?.querySelector('.group-menu-btn') as Element);
  click(
    Array.from(
      (groupBtnFor('Keep').closest('li') as HTMLElement).querySelectorAll<HTMLButtonElement>(
        ':scope > .group-menu .group-menu-item',
      ),
    ).find((b) => b.textContent === 'Rename') as HTMLButtonElement,
  );
  byId<HTMLInputElement>('new-group-name').value = 'Kept';
  click(dq('#dlg-new-group [data-action="create-group"]'));

  // Move "Mover" out of it, up to the root group.
  click(groupBtnFor('Kept'));
  openEntry('Mover');
  click(q('[data-action="move-entry"]'));
  click(
    Array.from(
      byId<HTMLElement>('move-to-tree').querySelectorAll<HTMLButtonElement>('.move-to-btn'),
    ).find((b) => b.textContent?.endsWith('Merge Vault')) as HTMLButtonElement,
  );

  // Trash an entry, then delete it from the bin.
  click(groupBtnFor('Merge Vault'));
  openEntry('Doomed Entry');
  click(q('[data-action="trash"]'));
  click(groupBtnFor('Recycle Bin'));
  openEntry('Doomed Entry');
  click(q('[data-action="delete"]'));
  confirmDelete();

  // Trash a group, then delete it, and the entry inside it, from the bin.
  click(groupBtnFor('Doomed Group'));
  click(q('[data-action="delete-group"]'));
  confirmDelete();
  click(groupBtnFor('Doomed Group'));
  click(q('[data-action="delete-group"]'));
  confirmDelete();

  // Save, keeping the bytes the download hands to the browser.
  const downloads: Blob[] = [];
  const realCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    downloads.push(obj as Blob);
    return realCreate(obj);
  };
  try {
    click(q('[data-action="save-database"]'));
    click(dq('#dlg-save [data-action="download"]'));
    await waitFor(() => downloads.length === 1);
  } finally {
    URL.createObjectURL = realCreate;
  }
  const saved = await Kdbx.load(
    new Uint8Array(await (downloads[0] as Blob).arrayBuffer()),
    credentials,
  );

  const savedRoot = saved.getRootGroup();
  const savedKept = getChildren(savedRoot, 'Group').find(
    (g) => uuidOf(g) === uuidOf(keep),
  ) as XmlElement;
  assert.equal(getText(getChild(savedKept, 'Name') as XmlElement), 'Kept');
  assert.notEqual(
    getText(timeEl(savedKept, 'LastModificationTime')),
    LONG_AGO,
    'a rename is an edit',
  );
  assert.equal(getText(timeEl(savedKept, 'LocationChanged')), LONG_AGO, 'but not a move');

  const savedMover = getChildren(savedRoot, 'Entry').find(
    (e) => uuidOf(e) === uuidOf(mover),
  ) as XmlElement;
  assert.notEqual(getText(timeEl(savedMover, 'LocationChanged')), LONG_AGO, 'a move');
  assert.equal(getText(timeEl(savedMover, 'LastModificationTime')), LONG_AGO, 'but not an edit');

  const deletedObjects = getChild(
    getChild(saved.root, 'Root') as XmlElement,
    'DeletedObjects',
  ) as XmlElement;
  assert.deepEqual(
    getChildren(deletedObjects, 'DeletedObject').map((record) =>
      getText(getChild(record, 'UUID') as XmlElement),
    ),
    [uuidOf(doomedEntry), uuidOf(doomedGroup), uuidOf(doomedChild)],
  );
  assert.ok(
    getChild(getChild(saved.root, 'Meta') as XmlElement, 'RecycleBinChanged'),
    'creating the bin is recorded',
  );

  click(q('[data-action="close"]'));
  click(dq('#dlg-confirm-discard [data-action="confirm-discard"]'));
});

test('entry list sorting: by title, username, or modified time, in either direction', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const rootGroup = kdbx.getRootGroup();
  const bob = createEntry({ title: 'Bob', username: 'zeta' });
  const alice = createEntry({ title: 'Alice', username: 'alpha' });
  appendChild(rootGroup, bob);
  appendChild(rootGroup, alice);
  // createEntry() stamps both with "now" — set distinguishable modified times directly.
  const modifiedOf = (entry: XmlElement): XmlElement =>
    getChild(getChild(entry, 'Times') as XmlElement, 'LastModificationTime') as XmlElement;
  setText(modifiedOf(bob), '2020-01-01T00:00:00Z');
  setText(modifiedOf(alice), '2024-01-01T00:00:00Z');
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('sorting.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  const titles = (): (string | null)[] =>
    Array.from(root().querySelectorAll<HTMLElement>('.entry-row-title')).map(
      (el) => el.textContent,
    );
  const sortSelect = q<HTMLSelectElement>('#sort-select');

  // Default: title ascending.
  assert.equal(sortSelect.value, 'title:asc');
  assert.ok(titles()[0]?.includes('Alice'));
  assert.ok(titles()[1]?.includes('Bob'));

  sortSelect.value = 'title:desc';
  dispatch(sortSelect, 'change');
  assert.ok(titles()[0]?.includes('Bob'));
  assert.ok(titles()[1]?.includes('Alice'));

  sortSelect.value = 'username:asc';
  dispatch(sortSelect, 'change');
  assert.ok(titles()[0]?.includes('Alice'), '"alpha" sorts before "zeta"');

  sortSelect.value = 'username:desc';
  dispatch(sortSelect, 'change');
  assert.ok(titles()[0]?.includes('Bob'));

  sortSelect.value = 'modified:desc';
  dispatch(sortSelect, 'change');
  assert.ok(titles()[0]?.includes('Alice'), 'Alice (2024) is newer than Bob (2020)');

  sortSelect.value = 'modified:asc';
  dispatch(sortSelect, 'change');
  assert.ok(titles()[0]?.includes('Bob'));

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('entry list table view: columns, masked password, click to copy, button to open', async (t) => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const rootGroup = kdbx.getRootGroup();
  appendChild(
    rootGroup,
    createEntry({
      title: 'GitHub',
      username: 'octocat',
      password: 'hunter2',
      url: 'https://github.com',
      notes: 'work account',
    }),
  );
  appendChild(rootGroup, createEntry({ title: 'No Password', username: 'bare' }));
  const bytes = await kdbx.save();

  const findKey = (init: Record<string, unknown> = { key: 'f', metaKey: true }): Event =>
    dispatch(dom.window.document, 'keydown', init);
  assert.equal(findKey().defaultPrevented, false, 'no database, so no in-app find (#78)');

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('views.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  dispatch(q('[data-action="view-table"]'), 'click');
  assert.equal(root().querySelectorAll('.entry-row').length, 0, 'tiles are gone');
  assert.ok(q('.entry-table'), 'a table is rendered instead');
  assert.equal(q<HTMLButtonElement>('#column-picker-btn').hidden, false);

  const headerText = (): string[] =>
    Array.from(root().querySelectorAll('.entry-table th')).map((th) => th.textContent ?? '');
  assert.deepEqual(
    headerText(),
    ['Icon', 'Title', 'Username', 'Password', 'URL', 'Modified', 'Open'],
    "default visible columns, plus the icon and open columns' screen-reader-only names",
  );

  // Columns resize the way the group rail does. jsdom has no layout engine, so
  // every drag starts from a zero-width column; that still proves the
  // arithmetic, the clamps, and that a width survives the table being rebuilt.
  const urlTh = (): HTMLElement => q<HTMLElement>('th[data-column="url"]');
  const urlHandle = (): HTMLElement => q<HTMLElement>('th[data-column="url"] .col-resize');
  assert.equal(urlHandle().getAttribute('aria-label'), 'Resize URL column');

  dispatch(urlHandle(), 'pointerdown', { clientX: 100, pointerId: 1 });
  dispatch(urlHandle(), 'pointermove', { clientX: 420, pointerId: 1 });
  assert.equal(urlTh().style.width, '320px');
  assert.equal(urlHandle().getAttribute('aria-valuenow'), '320');

  dispatch(urlHandle(), 'pointermove', { clientX: 0, pointerId: 1 });
  assert.equal(urlTh().style.width, '80px', 'clamped at the narrow end');
  dispatch(urlHandle(), 'pointermove', { clientX: 9000, pointerId: 1 });
  assert.equal(urlTh().style.width, '640px', 'clamped at the wide end');

  dispatch(urlHandle(), 'pointerup', { clientX: 9000, pointerId: 1 });
  dispatch(urlHandle(), 'pointermove', { clientX: 250, pointerId: 1 });
  assert.equal(urlTh().style.width, '640px', 'releasing stops tracking the pointer');

  dispatch(urlHandle(), 'keydown', { key: 'ArrowLeft' });
  assert.equal(urlTh().style.width, '624px', 'one step narrower than the 640 just dragged to');
  dispatch(urlHandle(), 'keydown', { key: 'a' });
  assert.equal(urlTh().style.width, '624px', 'unchanged by a non-arrow key');
  dispatch(urlHandle(), 'keydown', { key: 'ArrowRight' });
  assert.equal(urlTh().style.width, '640px', 'one step wider, back at the ceiling');

  dispatch(q('[data-action="view-tile"]'), 'click');
  dispatch(q('[data-action="view-table"]'), 'click');
  assert.equal(urlTh().style.width, '640px', 'the rebuilt column kept its width');
  assert.equal(urlHandle().getAttribute('aria-valuenow'), '640');

  // A column nobody has touched carries no width of its own and reports what it
  // was laid out at, which under jsdom is zero.
  assert.equal(q<HTMLElement>('th[data-column="title"]').style.width, '');
  assert.equal(
    q<HTMLElement>('th[data-column="title"] .col-resize').getAttribute('aria-valuenow'),
    '0',
  );

  // The cell's own text, without the copy control beside it (#76).
  const bodyCells = (): string[] =>
    Array.from(root().querySelectorAll('.entry-table tbody .entry-cell-text')).map(
      (text) => text.textContent ?? '',
    );
  const [titleCell, usernameCell, passwordCell, urlCell] = bodyCells();
  assert.ok(titleCell?.includes('GitHub'));

  // The copy control leads the value, a sibling of its text box rather than
  // part of it, which is what keeps it in view and plainly tied to it (#76, #87).
  const firstCell = q<HTMLElement>('.entry-table tbody td.entry-table-title');
  assert.equal(
    firstCell.querySelector('.entry-cell')?.firstElementChild?.className,
    'copy-hint',
    'it comes before the text box, as a sibling of it',
  );
  // The entry's icon has a cell of its own, so nothing sits between copy and the title (#87).
  assert.equal(firstCell.querySelector('.entry-cell-text')?.textContent, 'GitHub');
  assert.equal(firstCell.previousElementSibling?.className, 'entry-table-icon');
  assert.equal(iconOf(firstCell.previousElementSibling as Element), '#icon-key');
  assert.equal(usernameCell, 'octocat');
  assert.equal(passwordCell, '••••••••', 'password is masked on screen');
  assert.equal(urlCell, 'https://github.com');

  const noPasswordRow = Array.from(root().querySelectorAll('.entry-table tbody tr')).find((tr) =>
    tr.textContent?.includes('No Password'),
  ) as HTMLElement;
  assert.equal(
    noPasswordRow.querySelector('td.entry-table-protected')?.textContent,
    '',
    'empty, not a row of dots',
  );

  dispatch(q('[data-action="toggle-columns"]'), 'click');
  assert.equal(q<HTMLElement>('#column-picker-menu').hidden, false);
  const notesCheckbox = Array.from(
    root().querySelectorAll<HTMLInputElement>('.column-picker-item input'),
  ).find((input) => input.closest('.column-picker-item')?.textContent?.trim() === 'Notes');
  assert.ok(notesCheckbox, 'a Notes checkbox exists');
  (notesCheckbox as HTMLInputElement).checked = true;
  dispatch(notesCheckbox as HTMLInputElement, 'change');
  assert.ok(headerText().includes('Notes'), 'Notes column now shown');
  assert.ok(bodyCells().includes('work account'));

  t.mock.timers.enable({ apis: ['setTimeout'] });
  clipboardWritesShouldFail = false;
  const maskedCell = (): HTMLElement =>
    Array.from(root().querySelectorAll('.entry-table tbody td')).find(
      (td) => td.querySelector('.entry-cell-text')?.textContent === '••••••••',
    ) as HTMLElement;

  // A click copies the real value, names it, and leaves the card shut.
  dispatch(maskedCell(), 'click');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clipboardText, 'hunter2', 'the real password was copied, not the mask');
  assert.equal(byId<HTMLElement>('toast').hidden, false);
  assert.equal(byId<HTMLElement>('toast-message').textContent, 'Password copied to clipboard');
  assert.ok(!byId<HTMLElement>('toast').textContent?.includes('hunter2'), 'never the value itself');
  assert.equal(q('#detail-title'), null, 'copying never opens the card');

  // The copy control is a real button, so a keyboard reaches it; its click must not also
  // run the cell's own handler underneath.
  clipboardText = '';
  const hintBtn = maskedCell().querySelector('.copy-hint') as HTMLButtonElement;
  assert.equal(hintBtn.title, 'Copy password', 'the button carries its own name');
  dispatch(hintBtn, 'click');
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(clipboardText, 'hunter2', 'the copy button copies exactly once');

  // A web address opens in a tab of its own, and opening copies nothing (#86).
  const opened: unknown[][] = [];
  const realOpen = dom.window.open;
  dom.window.open = ((...args: unknown[]) => {
    opened.push(args);
    return null;
  }) as typeof dom.window.open;
  try {
    const urlCell = Array.from(root().querySelectorAll('.entry-table tbody td')).find(
      (td) => td.querySelector('.entry-cell-text')?.textContent === 'https://github.com',
    ) as HTMLElement;
    const openBtn = urlCell.querySelector('.open-hint') as HTMLButtonElement;
    assert.equal(openBtn.title, 'Open URL in a new tab');
    clipboardText = '';
    dispatch(openBtn, 'click');
    await Promise.resolve();
    assert.deepEqual(opened, [['https://github.com/', '_blank', 'noopener,noreferrer']]);
    assert.equal(clipboardText, '', 'and copies nothing');
  } finally {
    dom.window.open = realOpen;
  }
  assert.equal(
    root().querySelectorAll('.open-hint').length,
    1,
    'only a cell holding a web address offers to open it',
  );

  // Find looks through the database rather than the page, so it takes the
  // keystroke and puts the caret in the search field with whatever was already
  // typed selected, ready to be replaced (#78).
  q<HTMLInputElement>('#search-input').value = 'stale';
  assert.equal(findKey().defaultPrevented, true);
  assert.equal(dom.window.document.activeElement, q('#search-input'), 'the caret moved there');
  assert.equal(q<HTMLInputElement>('#search-input').selectionStart, 0, 'over the whole value');
  assert.equal(q<HTMLInputElement>('#search-input').selectionEnd, 'stale'.length);

  assert.equal(findKey({ key: 'f', ctrlKey: true }).defaultPrevented, true, 'ctrl works too');
  assert.equal(findKey({ key: 'g', metaKey: true }).defaultPrevented, false);
  assert.equal(findKey({ key: 'f' }).defaultPrevented, false, 'unmodified f is just typing');
  assert.equal(findKey({ key: 'f', metaKey: true, shiftKey: true }).defaultPrevented, false);
  assert.equal(findKey({ key: 'f', ctrlKey: true, altKey: true }).defaultPrevented, false);
  q<HTMLInputElement>('#search-input').value = '';

  // A modal has the keyboard; the list behind it is not what find is about.
  dispatch(q('[data-action="settings"]'), 'click');
  assert.equal(findKey().defaultPrevented, false, 'the dialog keeps the keystroke');
  dispatch(dq('#dlg-settings [data-action="close"]'), 'click');
  assert.equal(findKey().defaultPrevented, true, 'and find works again once it is gone');

  // Opening the card is its own button, never a gesture over the values.
  const openBtn = (q('.entry-table tbody tr') as HTMLElement).querySelector(
    '.entry-table-open button',
  ) as HTMLButtonElement;
  dispatch(openBtn, 'click');
  assert.ok(q<HTMLElement>('#detail-title')?.textContent?.includes('GitHub'), 'the › opens it');

  // The card is read-only, so find can leave it and go back to the list (#78).
  assert.equal(findKey().defaultPrevented, true);
  assert.equal(q('#detail-title'), null, 'the card gave way to the list');
  assert.equal(dom.window.document.activeElement, q('#search-input'));

  // The edit screen holds typing nobody has committed, so find stays out of it.
  dispatch(q('.entry-table tbody .entry-table-open button'), 'click');
  dispatch(q('[data-action="edit"]'), 'click');
  assert.equal(findKey().defaultPrevented, false, 'the browser keeps its own find here');
  assert.ok(q('#edit-title'), 'and the edit screen is still the one showing');
  dispatch(q('[data-action="cancel"]'), 'click');
  dispatch(q('[data-action="back"]'), 'click');
  dispatch(q('[data-action="view-table"]'), 'click');

  // Turn on Created and Attachments too — Created exercises the other half
  // of entryColumnDisplayValue's date-formatting check, and Attachments (0,
  // so an empty cell) exercises double-clicking a cell with nothing to copy.
  dispatch(q('[data-action="toggle-columns"]'), 'click');
  const checkboxFor = (label: string): HTMLInputElement =>
    Array.from(root().querySelectorAll<HTMLInputElement>('.column-picker-item input')).find(
      (input) => input.closest('.column-picker-item')?.textContent?.trim() === label,
    ) as HTMLInputElement;
  const createdCheckbox = checkboxFor('Created');
  createdCheckbox.checked = true;
  dispatch(createdCheckbox, 'change');
  const attachmentsCheckbox = checkboxFor('Attachments');
  attachmentsCheckbox.checked = true;
  dispatch(attachmentsCheckbox, 'change');
  assert.ok(headerText().includes('Created'));

  // Double-clicking an empty cell — with no preceding click on it at all, so
  // there's no pending open timer to cancel either — copies nothing.
  const columnIndex = headerText().indexOf('Attachments');
  const attachmentsTd = (q('.entry-table tbody tr') as HTMLElement).querySelectorAll('td')[
    columnIndex
  ] as HTMLElement;
  assert.equal(
    attachmentsTd.querySelector('.entry-cell-text')?.textContent,
    '',
    'no attachments on this entry',
  );
  assert.equal(attachmentsTd.querySelector('.copy-hint'), null, 'and so no copy hint');
  clipboardText = '';
  dispatch(attachmentsTd, 'click');
  await Promise.resolve();
  assert.equal(clipboardText, '', 'a cell with nothing in it copies nothing');

  dispatch(q('[data-action="view-tile"]'), 'click');
  assert.equal(root().querySelectorAll('.entry-row').length, 2);
  assert.equal(root().querySelectorAll('.entry-table').length, 0);

  // The tile and the card offer to open the address too, everywhere but edit (#86).
  const tileOpened: unknown[][] = [];
  const realTileOpen = dom.window.open;
  dom.window.open = ((...args: unknown[]) => {
    tileOpened.push(args);
    return null;
  }) as typeof dom.window.open;
  try {
    const tileOpenBtns = root().querySelectorAll<HTMLButtonElement>('.entry-row .open-hint');
    assert.equal(tileOpenBtns.length, 1, 'only the tile with a web address');
    dispatch(tileOpenBtns[0] as HTMLButtonElement, 'click');
    assert.equal(q('#detail-title'), null, 'opening the site does not open the entry');
    dispatch(tileOpenBtns[0]?.closest('.entry-row') as HTMLElement, 'click');
    assert.ok(
      q<HTMLElement>('#detail-title').textContent?.includes('GitHub'),
      'the tile still does',
    );

    const cardOpenBtn = Array.from(root().querySelectorAll('.detail-field'))
      .find((row) => row.querySelector('.detail-label')?.textContent === 'URL')
      ?.querySelector<HTMLButtonElement>('[title="Open URL in a new tab"]');
    assert.ok(cardOpenBtn, 'the card offers it beside the URL');
    dispatch(cardOpenBtn, 'click');
    assert.deepEqual(tileOpened, [
      ['https://github.com/', '_blank', 'noopener,noreferrer'],
      ['https://github.com/', '_blank', 'noopener,noreferrer'],
    ]);

    dispatch(q('[data-action="edit"]'), 'click');
    assert.equal(
      root().querySelector('[title="Open URL in a new tab"]'),
      null,
      'but not the edit screen',
    );
    dispatch(q('[data-action="cancel"]'), 'click');
    dispatch(q('[data-action="back"]'), 'click');
  } finally {
    dom.window.open = realTileOpen;
  }

  // The password copied above is still counting down; closing takes it along (#88).
  assert.equal(byId<HTMLElement>('toast').hidden, false);
  clipboardText = 'hunter2';
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(clipboardText, '');
  assert.equal(byId<HTMLElement>('toast').hidden, true);
});

test('the table marks the row and cell whose value is on the clipboard, for as long as it is (#177)', async (t) => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const rootGroup = kdbx.getRootGroup();
  appendChild(
    rootGroup,
    createEntry({ title: 'GitHub', username: 'octocat', password: 'hunter2' }),
  );
  appendChild(rootGroup, createEntry({ title: 'GitLab', username: 'tanuki', password: 'fox' }));
  const bytes = await kdbx.save();

  const unlock = async (): Promise<void> => {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    const keyfileInput = q<HTMLInputElement>('#keyfile-input');
    setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
    dispatch(keyfileInput, 'change');
    await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
    dispatch(q('#unlock-form'), 'submit');
    await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
  };
  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('marks.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  await unlock();
  dispatch(q('[data-action="view-table"]'), 'click');

  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  clipboardWritesShouldFail = false;
  // The writes happen inside an async handler; setImmediate is not mocked,
  // so waiting on it lets every microtask settle before the next step.
  const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const titleOf = (el: Element): string | null | undefined =>
    el.closest('tr')?.querySelector('.entry-table-title .entry-cell-text')?.textContent;
  const cellOf = (title: string, column: string): HTMLElement =>
    Array.from(root().querySelectorAll('.entry-table tbody tr'))
      .find((tr) => titleOf(tr) === title)
      ?.querySelector(`td[data-column="${column}"]`) as HTMLElement;
  // Each mark as its row's title, followed by the column for a marked cell.
  const marks = (): string[] =>
    Array.from(root().querySelectorAll<HTMLElement>('.entry-table .copied')).map((el) =>
      [titleOf(el), el.dataset.column].filter(Boolean).join(' '),
    );
  const pickColumn = (label: string, shown: boolean): void => {
    const checkbox = Array.from(
      root().querySelectorAll<HTMLInputElement>('.column-picker-item input'),
    ).find(
      (input) => input.closest('.column-picker-item')?.textContent?.trim() === label,
    ) as HTMLInputElement;
    checkbox.checked = shown;
    dispatch(checkbox, 'change');
  };

  assert.deepEqual(marks(), [], 'nothing of ours is on the clipboard yet');

  // A click marks the value's cell and row, once the browser has taken the value.
  dispatch(cellOf('GitHub', 'username'), 'click');
  assert.deepEqual(marks(), [], 'not before');
  await settle();
  assert.deepEqual(marks(), ['GitHub', 'GitHub username']);

  // A refused copy leaves the clipboard, and so the mark, as it was.
  const realError = console.error;
  console.error = () => {};
  clipboardWritesShouldFail = true;
  try {
    dispatch(cellOf('GitLab', 'password'), 'click');
    await settle();
  } finally {
    console.error = realError;
    clipboardWritesShouldFail = false;
  }
  assert.deepEqual(marks(), ['GitHub', 'GitHub username']);

  // The copy control marks the same way, and only the newest copy is marked.
  dispatch(cellOf('GitLab', 'password').querySelector('.copy-hint') as HTMLElement, 'click');
  await settle();
  assert.equal(clipboardText, 'fox');
  assert.deepEqual(marks(), ['GitLab', 'GitLab password']);

  // The table is rebuilt on every change, and the mark follows the entry through it.
  const search = q<HTMLInputElement>('#search-input');
  search.value = 'GitHub';
  dispatch(search, 'input');
  assert.deepEqual(marks(), [], 'its row is filtered out');
  search.value = '';
  dispatch(search, 'input');
  assert.deepEqual(marks(), ['GitLab', 'GitLab password'], 'and marked again once it is back');

  // Hiding the copied column leaves the value on the clipboard, so its row stays marked.
  dispatch(q('[data-action="toggle-columns"]'), 'click');
  pickColumn('Password', false);
  assert.deepEqual(marks(), ['GitLab']);
  pickColumn('Password', true);
  assert.deepEqual(marks(), ['GitLab', 'GitLab password']);

  // A copy from the card replaces the value, so nothing in the table is marked.
  dispatch(
    cellOf('GitHub', 'username')
      .closest('tr')
      ?.querySelector('.entry-table-open button') as Element,
    'click',
  );
  Array.from(root().querySelectorAll('.detail-field'))
    .find((row) => row.querySelector('.detail-label')?.textContent === 'UserName')
    ?.querySelector<HTMLButtonElement>('[title="Copy"]')
    ?.click();
  await settle();
  assert.equal(clipboardText, 'octocat');
  dispatch(q('[data-action="back"]'), 'click');
  assert.ok(q('.entry-table'), 'back at the table');
  assert.deepEqual(marks(), []);

  // A timed clear the browser refuses leaves the value, and the mark, in place...
  dispatch(cellOf('GitHub', 'password'), 'click');
  await settle();
  assert.deepEqual(marks(), ['GitHub', 'GitHub password']);
  clipboardWritesShouldFail = true;
  t.mock.timers.tick(30_000);
  await settle();
  clipboardWritesShouldFail = false;
  assert.equal(clipboardText, 'hunter2');
  assert.deepEqual(marks(), ['GitHub', 'GitHub password']);

  // ...until the clear lands.
  dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
  await settle();
  assert.equal(clipboardText, '');
  assert.deepEqual(marks(), []);

  // A lock drops the mark at once rather than with a clear the browser may refuse,
  // so the mark never keeps a locked database's entry alive.
  dispatch(cellOf('GitHub', 'password'), 'click');
  await settle();
  assert.deepEqual(marks(), ['GitHub', 'GitHub password']);
  clipboardWritesShouldFail = true;
  dispatch(q('[data-action="lock"]'), 'click');
  assert.ok(q('.entry-table'), 'the table is still up while the lock re-encrypts');
  assert.deepEqual(marks(), [], 'yet nothing in it is marked');
  t.mock.timers.reset(); // waitFor runs on real timers
  await waitFor(() => q('#master-password') !== null);
  clipboardWritesShouldFail = false;
  assert.equal(clipboardText, 'hunter2', 'the browser refused the clear');
  dom.window.dispatchEvent(new dom.window.Event('pointerdown'));
  await settle();
  assert.equal(clipboardText, '', 'and let it through at the next click');

  await unlock();

  // Trashing keeps the entry, so its mark goes along into the bin.
  const openCard = (title: string): void => {
    dispatch(
      cellOf(title, 'title').closest('tr')?.querySelector('.entry-table-open button') as Element,
      'click',
    );
  };
  const deleteFromCard = (title: string): void => {
    openCard(title);
    dispatch(q('[data-action="delete"]'), 'click');
    dispatch(dq('#dlg-confirm-delete [data-action="confirm-delete"]'), 'click');
  };
  dispatch(cellOf('GitLab', 'password'), 'click');
  await settle();
  assert.deepEqual(marks(), ['GitLab', 'GitLab password']);
  openCard('GitLab');
  dispatch(q('[data-action="trash"]'), 'click');
  assert.deepEqual(marks(), [], 'its row has left this group');
  openCard('GitHub');
  dispatch(q('[data-action="trash"]'), 'click');
  dispatch(
    Array.from(q('#group-tree').querySelectorAll('.group-btn')).find((button) =>
      button.textContent?.endsWith('Recycle Bin'),
    ) as Element,
    'click',
  );
  assert.deepEqual(marks(), ['GitLab', 'GitLab password'], 'and is marked again in the bin');

  // Deleting another entry for good leaves the mark be; deleting its own lets the entry go.
  deleteFromCard('GitHub');
  assert.deepEqual(marks(), ['GitLab', 'GitLab password']);
  deleteFromCard('GitLab');
  assert.deepEqual(marks(), []);
  assert.equal(clipboardText, 'fox', 'though the value waits for its own clear');

  dispatch(q('[data-action="view-tile"]'), 'click');
  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  await settle();
  assert.equal(clipboardText, '', 'closing clears it');
});

test('entry list: the sidebar drawer and panel overflow menu (mobile layout) open and close', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('menus.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  // Sidebar drawer: hidden by default, opens via the hamburger button, and
  // can be closed either by the backdrop or by toggling the button again.
  const sidebar = q<HTMLElement>('#sidebar');
  const backdrop = q<HTMLElement>('#sidebar-backdrop');
  assert.equal(sidebar.classList.contains('sidebar-open'), false);
  assert.equal(backdrop.hidden, true);

  const drawerToggle = q('[data-action="toggle-sidebar"]');
  assert.equal(iconOf(drawerToggle), '#icon-drawer-open');
  dispatch(drawerToggle, 'click');
  assert.equal(sidebar.classList.contains('sidebar-open'), true);
  assert.equal(backdrop.hidden, false);
  // The toggle shows and names what pressing it next does (#121).
  assert.equal(iconOf(drawerToggle), '#icon-drawer-close');
  assert.equal(drawerToggle.getAttribute('aria-label'), 'Hide groups');

  dispatch(backdrop, 'click');
  assert.equal(sidebar.classList.contains('sidebar-open'), false);
  assert.equal(backdrop.hidden, true);
  assert.equal(iconOf(drawerToggle), '#icon-drawer-open');
  assert.equal(drawerToggle.getAttribute('aria-label'), 'Show groups');

  dispatch(q('[data-action="toggle-sidebar"]'), 'click');
  assert.equal(sidebar.classList.contains('sidebar-open'), true);
  dispatch(q('[data-action="toggle-sidebar"]'), 'click');
  assert.equal(sidebar.classList.contains('sidebar-open'), false);

  // Selecting a group also closes the drawer, so the entries it just
  // switched to are immediately visible instead of hidden behind it.
  dispatch(q('[data-action="toggle-sidebar"]'), 'click');
  assert.equal(sidebar.classList.contains('sidebar-open'), true);
  dispatch(q('#group-tree .group-btn') as HTMLElement, 'click');
  assert.equal(
    sidebar.classList.contains('sidebar-open'),
    false,
    'selecting a group closes the drawer',
  );

  // Panel overflow menu (sort/columns): toggles independently of the sidebar.
  const panelMenu = q<HTMLElement>('#panel-menu');
  assert.equal(panelMenu.classList.contains('panel-menu-open'), false);
  dispatch(q('[data-action="toggle-panel-menu"]'), 'click');
  assert.equal(panelMenu.classList.contains('panel-menu-open'), true);
  dispatch(q('[data-action="toggle-panel-menu"]'), 'click');
  assert.equal(panelMenu.classList.contains('panel-menu-open'), false);

  // Switching views closes it too — every render resets it via updateViewToggleUI.
  dispatch(q('[data-action="toggle-panel-menu"]'), 'click');
  assert.equal(panelMenu.classList.contains('panel-menu-open'), true);
  dispatch(q('[data-action="view-table"]'), 'click');
  assert.equal(panelMenu.classList.contains('panel-menu-open'), false);

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('exporting entries as CSV or XML downloads an unencrypted plaintext file', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'Exported Entry', username: 'exp-user' }));
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('vault.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  q('[data-action="export"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  const dlg = byId<HTMLDialogElement>('dlg-export');
  assert.equal(dlg.open, true);
  assert.match(dq('.warning-text').textContent ?? '', /unencrypted/i);

  const created: string[] = [];
  const revoked: string[] = [];
  const realCreate = URL.createObjectURL.bind(URL);
  const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (obj: Blob | MediaSource) => {
    const u = realCreate(obj);
    created.push(u);
    return u;
  };
  URL.revokeObjectURL = (u: string) => {
    revoked.push(u);
    realRevoke(u);
  };
  try {
    dq('#dlg-export [data-action="export-csv"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false, 'exporting closes the dialog');

    q('[data-action="export"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    dq('#dlg-export [data-action="export-xml"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);
  } finally {
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
  assert.equal(created.length, 2, 'one object URL per export');
  assert.deepEqual(revoked, created, 'every created URL is revoked');

  // The close (✕) button dismisses without exporting anything.
  q('[data-action="export"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-export [data-action="close"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
  assert.equal(dlg.open, false);
  assert.equal(created.length, 2, 'closing must not trigger another export');

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('exporting falls back to "entries" as the base filename when none is set', async () => {
  const credentials = new Credentials({ password: PASSWORD, keyFile: KEYFILE });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  // A filename that's just the extension strips to '' — exercises the
  // "|| 'entries'" fallback in openExportDialog's base filename.
  setFiles(fileInput, [makeFile('.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  q('[data-action="export"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  const downloadNames: string[] = [];
  const realClick = dom.window.HTMLAnchorElement.prototype.click;
  dom.window.HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
    downloadNames.push(this.download);
  };
  try {
    dq('#dlg-export [data-action="export-csv"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
  } finally {
    dom.window.HTMLAnchorElement.prototype.click = realClick;
  }
  assert.deepEqual(downloadNames, ['entries.csv']);

  q('[data-action="close"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );
});

test('must() throws when a screen template is missing an element it depends on', async () => {
  // Re-upload and unlock again so there's a live app state to work with,
  // independent of the walkthrough above.
  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('again.kdbx', dbBytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);

  q<HTMLInputElement>('#master-password').value = PASSWORD;
  const keyfileInput = q<HTMLInputElement>('#keyfile-input');
  setFiles(keyfileInput, [makeFile('keyfile.bin', KEYFILE)]);
  dispatch(keyfileInput, 'change');
  await waitFor(() => q<HTMLElement>('#keyfile-label').textContent === 'keyfile.bin');
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  // #root itself is what every screen render looks up first (via setRoot);
  // removing it makes the very next screen transition's lookup fail for
  // real, exercising must()'s throw branch through a genuine, reachable
  // path rather than a contrived direct call (page.ts exports nothing to
  // call directly). Per spec, DOM event listener exceptions are reported to
  // the console, not rethrown to dispatchEvent's caller — jsdom's virtual
  // console surfaces them as a 'jsdomError' event instead. Close (not lock)
  // is used here specifically because confirming it renders the next screen
  // synchronously — lock always awaits Kdbx#save() first, which would make
  // the throw happen after this test's synchronous assertion already ran.
  const closeBtn = q('[data-action="close"]');
  root().remove();

  let captured: Error | undefined;
  dom.virtualConsole.on('jsdomError', (err: Error) => {
    captured = err;
  });
  // Closing a saved database asks first, so the render happens on confirming.
  closeBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  dq('#dlg-confirm-discard [data-action="confirm-discard"]').dispatchEvent(
    new dom.window.Event('click', { bubbles: true }),
  );

  assert.ok(captured, 'removing #root should make the next screen render throw');
  assert.match(String(captured?.message ?? captured), /expected element not found/);
});

// Last on purpose: it checks every icon the tests above made the app draw. A
// misspelled symbol name draws nothing rather than failing, and an unused
// symbol is download weight with no purpose, so both are caught here (#121).
test('every icon drawn names a sprite symbol, every symbol is drawn, and the sprite only draws', () => {
  const doc = dom.window.document;
  for (const template of doc.querySelectorAll('template')) recordIcons(template.content);
  recordIcons(doc.body);
  const symbols = Array.from(doc.querySelectorAll('.icon-sprite symbol'), (s) => `#${s.id}`);
  for (const href of drawnIcons) assert.ok(symbols.includes(href), `${href} names no symbol`);
  for (const href of symbols) assert.ok(drawnIcons.has(href), `${href} is never drawn`);

  // Nothing in the sprite can load, link, or run anything: plain shapes only.
  const shapes = new Set(['symbol', 'path', 'circle', 'rect']);
  const geometry = new Set([
    'id',
    'viewBox',
    'd',
    'cx',
    'cy',
    'r',
    'x',
    'y',
    'width',
    'height',
    'rx',
  ]);
  for (const el of doc.querySelectorAll('.icon-sprite *')) {
    assert.ok(shapes.has(el.localName), `<${el.localName}> in the sprite`);
    for (const attr of el.attributes)
      assert.ok(geometry.has(attr.name), `${attr.name} in the sprite`);
  }
});
