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
 * Two real, upstream gaps this file works around rather than pretends don't
 * exist: jsdom does not implement HTMLDialogElement's showModal()/close()
 * (tracked upstream: https://github.com/jsdom/jsdom/issues/3294, still open
 * as of the jsdom version pinned here) or the Clipboard API at all. Both are
 * given minimal, behavior-only polyfills below — open/close state and a
 * writable clipboard buffer, nothing about real focus-trapping or OS
 * clipboard access, which page.ts doesn't rely on anyway.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  appendChild,
  Credentials,
  createElement,
  createEntry,
  createGroup,
  getAttribute,
  getChild,
  getChildren,
  getText,
  Kdbx,
  setAttribute,
} from '../../packages/kdbx/src/index.ts';
import * as logic from '../0x67/logic.ts';

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
(
  dom.window.navigator as unknown as { clipboard: { writeText(text: string): Promise<void> } }
).clipboard = {
  async writeText(text: string): Promise<void> {
    if (clipboardWritesShouldFail) throw new Error('simulated clipboard failure');
    clipboardText = text;
  },
};

// --- Hoist the kdbx library and this page's own pure logic onto globalThis,
// --- exactly like bundle.js does in the real browser build (see
// --- bundle-iife.json's "exports" list, which this mirrors exactly). ---
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
  createEntry,
  createGroup,
  ...logic,
});

await import('../0x67/page.ts');

// ============================================================
// Test helpers
// ============================================================

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
  // back to ''" branch of buildEntryRow's `username || url || ''`.
  appendChild(rootGroup, createEntry({ title: 'No Contact Info' }));
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
  });

  await t.test('unlock screen "back" returns to upload and clears the file', () => {
    q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.ok(q('#drop-zone'));
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

      // Reset back to the upload screen for the rest of the walkthrough
      // (lock still does a full reset at this point in the walkthrough).
      q('[data-action="lock"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
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

  await t.test('the correct password and key file unlock into the entry list', async () => {
    q<HTMLInputElement>('#master-password').value = PASSWORD;
    dispatch(q('#unlock-form'), 'submit');

    await waitFor(() => dom.window.document.body.classList.contains('app-mode'));
    assert.ok(q('#group-tree').querySelector('.group-btn'));
    // Root group is selected by default: four entries at the root.
    assert.equal(root().querySelectorAll('.entry-row').length, 4);
  });

  await t.test(
    'entry rows fall back through username/URL/blank meta text, and malformed fields are skipped',
    () => {
      const rowFor = (title: string): HTMLElement =>
        Array.from(root().querySelectorAll('.entry-row')).find(
          (r) => r.querySelector('.entry-row-title')?.textContent === title,
        ) as HTMLElement;

      // Has a username: meta shows it (already covered by every other row
      // in this fixture — asserted here too for a clear three-way contrast).
      assert.equal(rowFor('GitHub').querySelector('.entry-row-meta')?.textContent, 'octocat');
      // No username, no URL: falls all the way back to ''.
      assert.equal(rowFor('No Contact Info').querySelector('.entry-row-meta')?.textContent, '');
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

      const workBtn = buttons.find((b) => b.textContent === 'Work');
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

    const nameInput = byId<HTMLInputElement>('new-group-name');
    nameInput.value = 'Personal';
    // Exercise the Enter-to-submit path specifically (distinct from clicking
    // the Create button directly).
    const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
    nameInput.dispatchEvent(enter);

    assert.equal(dlg.open, false);
    assert.equal(q<HTMLElement>('#panel-title').textContent, 'Personal');
    assert.equal(root().querySelector('.entry-empty')?.textContent, 'No entries in this group.');
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
    }
  });

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

    q('[data-action="save"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));

    assert.equal(q<HTMLElement>('#detail-title').textContent, 'Custom Title');
    assert.equal(byId<HTMLDialogElement>('dlg-save').open, true);
  });

  await t.test('save dialog: "Later" dismisses without downloading', () => {
    dq('#dlg-save [data-action="close"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(byId<HTMLDialogElement>('dlg-save').open, false);
  });

  await t.test('downloading the database creates and revokes an object URL', async () => {
    q('[data-action="edit"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
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
    assert.equal(q<HTMLElement>('#detail-title').textContent, 'Custom Title');
  });

  await t.test('a protected field can be revealed and hidden again', () => {
    const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
      (row) => row.querySelector('.detail-label')?.textContent === 'Password',
    ) as HTMLElement;
    const valueSpan = passwordRow.querySelector('.detail-value') as HTMLElement;
    assert.equal(valueSpan.textContent, '••••••••');

    const revealBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Show / hide"]');
    revealBtn?.click();
    assert.notEqual(valueSpan.textContent, '••••••••');
    revealBtn?.click();
    assert.equal(valueSpan.textContent, '••••••••');
  });

  await t.test(
    'copying a field writes to the clipboard, flips the icon, then reverts on a timer',
    (t) => {
      t.mock.timers.enable({ apis: ['setTimeout'] });
      const passwordRow = Array.from(root().querySelectorAll('.detail-field')).find(
        (row) => row.querySelector('.detail-label')?.textContent === 'Password',
      ) as HTMLElement;
      const copyBtn = passwordRow.querySelector<HTMLButtonElement>('[title="Copy"]');

      clipboardWritesShouldFail = false;
      copyBtn?.click();
      // The write and the icon flip both happen inside an async click handler;
      // let its microtasks settle before advancing fake timers.
      return Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          assert.equal(copyBtn?.textContent, '✓');
          // Second, immediate copy exercises the "clear the pending timer"
          // branch in copyToClipboard before advancing time at all.
          copyBtn?.click();
          return Promise.resolve().then(() => Promise.resolve());
        })
        .then(() => {
          t.mock.timers.tick(1500);
          assert.equal(copyBtn?.textContent, '📋');
          // The clipboard-clear timer (app.clipboardTimeout, still the
          // default 30s here) was reset by the second copy above; advance
          // past it to cover the auto-clear callback itself. Force this
          // specific write to reject too, so the callback's own
          // `.catch(() => {})` — silently swallowing a failed best-effort
          // clear — actually runs instead of just being attached.
          clipboardText = 'still there before the timer fires';
          clipboardWritesShouldFail = true;
          t.mock.timers.tick(30_000);
          return Promise.resolve().then(() => Promise.resolve());
        })
        .then(() => {
          clipboardWritesShouldFail = false;
          // The rejected write must not throw, and must not have "succeeded"
          // in clearing the (mock) clipboard either.
          assert.equal(clipboardText, 'still there before the timer fires');
        });
    },
  );

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

  await t.test('deleting an entry: cancel keeps it, confirm removes it', () => {
    const entryCountBefore = () => {
      q('[data-action="back"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      const count = root().querySelectorAll('.entry-row').length;
      const row = root().querySelector('.entry-row') as HTMLElement;
      row.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
      return count;
    };
    const before = entryCountBefore();

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
    assert.equal(root().querySelectorAll('.entry-row').length, before - 1);
  });

  await t.test('settings: a valid timeout is saved, an invalid one is silently ignored', () => {
    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    let dlg = byId<HTMLDialogElement>('dlg-settings');
    assert.equal(byId<HTMLInputElement>('clipboard-timeout').value, '30');

    byId<HTMLInputElement>('clipboard-timeout').value = '10';
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);

    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(byId<HTMLInputElement>('clipboard-timeout').value, '10');
    byId<HTMLInputElement>('clipboard-timeout').value = '2';
    dq('#dlg-settings [data-action="save-settings"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );

    q('[data-action="settings"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.equal(
      byId<HTMLInputElement>('clipboard-timeout').value,
      '10',
      'an out-of-range timeout must not overwrite the saved one',
    );
    dlg = byId<HTMLDialogElement>('dlg-settings');
    dq('#dlg-settings [data-action="close"]').dispatchEvent(
      new dom.window.Event('click', { bubbles: true }),
    );
    assert.equal(dlg.open, false);
  });

  await t.test('locking resets app state and returns to the upload screen', () => {
    q('[data-action="lock"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
    assert.ok(q('#drop-zone'));
    assert.equal(dom.window.document.body.classList.contains('app-mode'), false);
  });
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
  // console surfaces them as a 'jsdomError' event instead.
  const lockBtn = q('[data-action="lock"]');
  root().remove();

  let captured: Error | undefined;
  dom.virtualConsole.on('jsdomError', (err: Error) => {
    captured = err;
  });
  lockBtn.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.ok(captured, 'removing #root should make the next screen render throw');
  assert.match(String(captured?.message ?? captured), /expected element not found/);
});
