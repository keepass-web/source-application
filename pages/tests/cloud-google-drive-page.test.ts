/**
 * Behavioral tests for cloud-google-drive/page.ts, driven through the real
 * page.html markup in jsdom exactly like 0x67-page.test.ts drives the app. The
 * network (fetch), the sign-in popup (window.open), and the embedded 0x67
 * iframe are all mocked, so the whole connector flow — sign in, list, open,
 * save back — runs without leaving the process.
 *
 * page.ts is a stateful singleton loaded once, so this is one ordered
 * walkthrough that builds on prior state, not independent tests. The
 * popup-callback boot branch is covered separately in
 * cloud-google-drive-callback.test.ts (it needs a different module-scope
 * environment).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as logic from '../cloud-google-drive/logic.ts';

// ============================================================
// Environment
// ============================================================

const htmlPath = fileURLToPath(new URL('../cloud-google-drive/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });
const APP_ORIGIN = 'https://example.com';

// --- window.open: capture the auth URL, return nothing ---
let openCount = 0;
let lastAuthUrl = '';
Object.defineProperty(dom.window, 'open', {
  value: (url: string) => {
    openCount += 1;
    lastAuthUrl = String(url);
    return null;
  },
  configurable: true,
  writable: true,
});

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

// --- fetch: routed to per-scenario handlers by URL ---
interface MockResponse {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
}
type Handler = () => Promise<MockResponse>;
const handlers: { token: Handler; list: Handler; download: Handler; save: Handler } = {
  token: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  list: async () => ({ ok: true, status: 200, json: async () => ({ files: [] }) }),
  download: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }),
  save: async () => ({ ok: true, status: 200 }),
};
Object.defineProperty(globalThis, 'fetch', {
  value: ((input: RequestInfo | URL): Promise<MockResponse> => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return handlers.token();
    if (url.includes('/upload/')) return handlers.save();
    if (url.includes('alt=media')) return handlers.download();
    if (url.includes('/files?')) return handlers.list();
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch,
  configurable: true,
  writable: true,
});

Object.assign(globalThis, logic);

await import('../cloud-google-drive/page.ts');

// ============================================================
// Helpers
// ============================================================

const doc = dom.window.document;
const root = (): HTMLElement => doc.getElementById('root') as HTMLElement;
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;
const qa = (selector: string): Element[] => Array.from(root().querySelectorAll(selector));

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

function sendMessage(data: unknown, opts: { origin?: string; source?: unknown } = {}): void {
  const evt = new dom.window.Event('message');
  Object.assign(evt, {
    data,
    origin: opts.origin ?? APP_ORIGIN,
    source: 'source' in opts ? opts.source : dom.window,
  });
  dom.window.dispatchEvent(evt);
}

/** Click "Sign in", wait for the popup to open, and return the state token the
 * connector put in the auth URL (so a matching callback can be faked). */
async function beginSignIn(): Promise<string> {
  const before = openCount;
  click(q('[data-action="signin"]'));
  await waitFor(() => openCount > before);
  return new URL(lastAuthUrl).searchParams.get('state') ?? '';
}

const okJson =
  (body: unknown): Handler =>
  async () => ({ ok: true, status: 200, json: async () => body });
const errStatus =
  (status: number): Handler =>
  async () => ({ ok: false, status });
const rejects: Handler = async () => {
  throw new Error('network down');
};

// ============================================================
// Walkthrough
// ============================================================

test('Google Drive connector', async (t) => {
  await t.test('boots to the sign-in screen', () => {
    assert.ok(q('[data-action="signin"]'));
  });

  await t.test('starting sign-in opens a PKCE auth URL in a popup', async () => {
    const state = await beginSignIn();
    const url = new URL(lastAuthUrl);
    assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('redirect_uri'), 'https://example.com/keepass/');
    assert.ok(url.searchParams.get('code_challenge'));
    assert.ok(state.length > 0);

    // Messages that fail the origin or shape guard are ignored (listener stays).
    sendMessage(
      { type: 'kw-oauth', code: 'c', state, error: null },
      { origin: 'https://evil.example' },
    );
    sendMessage({ type: 'not-oauth' });
    assert.ok(q('[data-action="signin"]'), 'still on sign-in');

    // A state that doesn't match is rejected.
    sendMessage({ type: 'kw-oauth', code: 'c', state: 'wrong-state', error: null });
    assert.match(q<HTMLElement>('#signin-error').textContent ?? '', /could not be verified/);
  });

  await t.test('a denied sign-in is reported', async () => {
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: null, state, error: 'access_denied' });
    assert.match(q<HTMLElement>('#signin-error').textContent ?? '', /cancelled or denied/);
  });

  await t.test('a callback with neither code nor error is reported', async () => {
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: null, state, error: null });
    assert.match(q<HTMLElement>('#signin-error').textContent ?? '', /cancelled or denied/);
  });

  await t.test('a failed token exchange surfaces the HTTP error', async () => {
    handlers.token = errStatus(400);
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: 'auth-code', state, error: null });
    await waitFor(() =>
      /Token exchange failed/.test(q<HTMLElement>('#signin-error').textContent ?? ''),
    );
    assert.match(q<HTMLElement>('#signin-error').textContent ?? '', /HTTP 400/);
  });

  await t.test('a non-Error thrown during exchange falls back to a generic message', async () => {
    handlers.token = async () => {
      throw 'a bare string, not an Error';
    };
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: 'auth-code', state, error: null });
    await waitFor(() => q<HTMLElement>('#signin-error').textContent === 'Sign-in failed.');
  });

  await t.test('a successful sign-in lands on the Drive browser and lists files', async () => {
    handlers.token = okJson({ access_token: 'tok' });
    handlers.list = okJson({
      files: [
        { id: 'f1', name: 'personal.kdbx', modifiedTime: '2026-07-01T00:00:00Z' },
        { id: 'f2', name: 'work.kdbx' }, // no modifiedTime → no meta line
      ],
    });
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: 'auth-code', state, error: null });

    await waitFor(() => q('#drive-search') !== null);
    await waitFor(() => qa('.drive-file').length === 2);
    assert.equal(qa('.drive-file-name')[0]?.textContent, 'personal.kdbx');
    assert.equal(qa('.drive-file-meta').length, 1, 'only the file with a modifiedTime shows meta');
  });

  await t.test(
    'search reloads the list; empty, HTTP, and network outcomes each show a message',
    async () => {
      const search = q<HTMLInputElement>('#drive-search');

      handlers.list = okJson({ files: [] });
      search.value = 'nothing';
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await waitFor(() => /No .kdbx files found/.test(q('#drive-files').textContent ?? ''));

      handlers.list = errStatus(500);
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await waitFor(() =>
        /Couldn't list files \(HTTP 500\)/.test(q('#drive-files').textContent ?? ''),
      );

      handlers.list = rejects;
      search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      await waitFor(() => /Network error while listing/.test(q('#drive-files').textContent ?? ''));
    },
  );

  await t.test(
    'opening a file: HTTP and network failures are reported, then success embeds the app',
    async () => {
      const reload = okJson({ files: [{ id: 'f1', name: 'personal.kdbx' }] });

      handlers.list = reload;
      q<HTMLInputElement>('#drive-search').dispatchEvent(
        new dom.window.Event('input', { bubbles: true }),
      );
      await waitFor(() => qa('.drive-file').length === 1);

      handlers.download = errStatus(404);
      click(q('.drive-file'));
      await waitFor(() =>
        /Couldn't open personal.kdbx \(HTTP 404\)/.test(q('#drive-files').textContent ?? ''),
      );

      handlers.list = reload;
      q<HTMLInputElement>('#drive-search').dispatchEvent(
        new dom.window.Event('input', { bubbles: true }),
      );
      await waitFor(() => qa('.drive-file').length === 1);

      handlers.download = rejects;
      click(q('.drive-file'));
      await waitFor(() =>
        /Network error while opening personal.kdbx/.test(q('#drive-files').textContent ?? ''),
      );

      handlers.list = reload;
      q<HTMLInputElement>('#drive-search').dispatchEvent(
        new dom.window.Event('input', { bubbles: true }),
      );
      await waitFor(() => qa('.drive-file').length === 1);

      handlers.download = async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(16),
      });
      click(q('.drive-file'));
      await waitFor(() => q('#app-frame') !== null);
      assert.equal(q<HTMLElement>('#host-filename').textContent, 'personal.kdbx');
    },
  );

  // --- Embedded-app message protocol -------------------------------------
  // Replace the iframe's contentWindow with a spy so we can both satisfy the
  // source check and capture what the connector posts into the app.

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
    assert.equal(msg?.filename, 'personal.kdbx');
    assert.ok(msg?.bytes instanceof ArrayBuffer);
  });

  await t.test('kw-save writes back to Drive and reports success', async () => {
    handlers.save = async () => ({ ok: true, status: 200 });
    sendMessage(
      { type: 'kw-save', filename: 'personal.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    await waitFor(() => frameInbox.length === 2);
    assert.deepEqual(frameInbox[1]?.message, { type: 'kw-saved', ok: true });
  });

  await t.test('a Drive write-back HTTP error is reported to the app', async () => {
    handlers.save = errStatus(403);
    sendMessage(
      { type: 'kw-save', filename: 'personal.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    await waitFor(() => frameInbox.length === 3);
    assert.deepEqual(frameInbox[2]?.message, { type: 'kw-saved', ok: false, error: 'HTTP 403' });
  });

  await t.test('a Drive write-back network error is reported to the app', async () => {
    handlers.save = rejects;
    sendMessage(
      { type: 'kw-save', filename: 'personal.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    await waitFor(() => frameInbox.length === 4);
    assert.deepEqual(frameInbox[3]?.message, {
      type: 'kw-saved',
      ok: false,
      error: 'network error',
    });
  });

  await t.test('a frame message after the iframe is gone is ignored', () => {
    q<HTMLIFrameElement>('#app-frame').remove();
    sendMessage({ type: 'kw-ready' }, { source: frameWin });
    assert.equal(frameInbox.length, 4, 'nothing more posted');
  });

  await t.test(
    'back to Drive returns to the browser, and sign-out returns to sign-in',
    async () => {
      handlers.list = okJson({ files: [{ id: 'f1', name: 'personal.kdbx' }] });
      click(q('[data-action="back-to-drive"]'));
      await waitFor(() => q('#drive-search') !== null);

      click(q('[data-action="signout"]'));
      assert.ok(q('[data-action="signin"]'));
    },
  );
});
