/**
 * Coverage for 0x67/page.ts's mobile-width initial default — entryView is
 * seeded from `window.innerWidth` once, at module scope (see the "Application
 * state" section), so exercising the narrow-viewport branch requires a fresh
 * module instance with a narrow window already in place before import, the
 * same reason 0x67-host.test.ts gets its own file for the embedded-host
 * branch instead of sharing 0x67-page.test.ts's already-imported module.
 *
 * node:test runs each test file in its own process, so importing page.ts
 * here re-evaluates its module scope independently of the standalone file's
 * (desktop-width) import.
 *
 * Same jsdom gap as the other 0x67 test files: HTMLDialogElement's
 * showModal()/close() aren't implemented, so they get the same
 * behavior-only polyfill.
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
  findOrCreateRecycleBin,
  getAttribute,
  getChild,
  getChildren,
  getText,
  isInRecycleBin,
  Kdbx,
  setAttribute,
  setText,
} from '../../packages/kdbx/src/index.ts';
import * as logic from '../0x67/logic.ts';

// ============================================================
// jsdom environment at a phone-width viewport
// ============================================================

const htmlPath = fileURLToPath(new URL('../0x67/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });

// jsdom's default innerWidth (1024) is desktop-width; override it before
// page.ts is imported below so its one-time entryView default sees a phone.
Object.defineProperty(dom.window, 'innerWidth', { value: 480, configurable: true });

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
  ...logic,
});

await import('../0x67/page.ts');

// ============================================================
// Helpers
// ============================================================

const root = (): HTMLElement => dom.window.document.getElementById('root') as HTMLElement;
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function dispatch(el: EventTarget, type: string): Event {
  const evt = new dom.window.Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(evt);
  return evt;
}

function setFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
}

function makeFile(name: string, bytes: Uint8Array): File {
  return new File([bytes as unknown as BlobPart], name);
}

const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;
const PASSWORD = 'unit-test-password';

// ============================================================
// The test
// ============================================================

test('on a phone-width viewport, the entry list defaults to tile view', async () => {
  const kdbx = await Kdbx.create(new Credentials({ password: PASSWORD }), {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
  });
  appendChild(kdbx.getRootGroup(), createEntry({ title: 'Phone Entry' }));
  const bytes = await kdbx.save();

  const fileInput = q<HTMLInputElement>('#file-input');
  setFiles(fileInput, [makeFile('mobile.kdbx', bytes)]);
  dispatch(fileInput, 'change');
  await waitFor(() => q('#master-password') !== null);
  q<HTMLInputElement>('#master-password').value = PASSWORD;
  dispatch(q('#unlock-form'), 'submit');
  await waitFor(() => dom.window.document.body.classList.contains('app-mode'));

  assert.ok(root().querySelector('.entry-list--tile'), 'tile view is active');
  assert.equal(root().querySelectorAll('.entry-list--table').length, 0);
  assert.equal(
    q<HTMLButtonElement>('[data-action="view-tile"]').classList.contains('active'),
    true,
  );
  assert.equal(
    q<HTMLButtonElement>('[data-action="view-table"]').classList.contains('active'),
    false,
  );
});
