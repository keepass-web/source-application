/**
 * Behavioral tests for cloud-google-drive/page.ts, driven through the real
 * page.html markup in jsdom. The network (fetch), the sign-in popup
 * (window.open), Google's Picker SDK (gapi / google.picker), the api.js script
 * load, and the embedded 0x67 iframe are all mocked, so the whole connector
 * flow — sign in, pick, open, save back — runs without leaving the process.
 *
 * page.ts is a stateful singleton loaded once, so this is one ordered
 * walkthrough that builds on prior state. The popup-callback boot branch is
 * covered separately in cloud-google-drive-callback.test.ts.
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

// --- window.open: capture the auth URL ---
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
const handlers: { token: Handler; download: Handler; save: Handler } = {
  token: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  download: async () => ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) }),
  save: async () => ({ ok: true, status: 200 }),
};
Object.defineProperty(globalThis, 'fetch', {
  value: ((input: RequestInfo | URL): Promise<MockResponse> => {
    const url = String(input);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return handlers.token();
    if (url.includes('/upload/')) return handlers.save();
    if (url.includes('alt=media')) return handlers.download();
    throw new Error(`unexpected fetch: ${url}`);
  }) as unknown as typeof fetch,
  configurable: true,
  writable: true,
});

// --- Google Picker SDK mock (gapi + google.picker) ---
let lastPickerCallback: ((data: Record<string, unknown>) => void) | null = null;
let pickerShownCount = 0;
class PickerBuilderMock {
  setOAuthToken(): this {
    return this;
  }
  setDeveloperKey(): this {
    return this;
  }
  addView(): this {
    return this;
  }
  setCallback(cb: (data: Record<string, unknown>) => void): this {
    lastPickerCallback = cb;
    return this;
  }
  build(): { setVisible: (visible: boolean) => void } {
    return {
      setVisible: () => {
        pickerShownCount += 1;
      },
    };
  }
}
const googleMock = {
  picker: {
    ViewId: { DOCS: 'docs' },
    Action: { PICKED: 'picked' },
    Response: { ACTION: 'action', DOCUMENTS: 'documents' },
    Document: { ID: 'id', NAME: 'name' },
    PickerBuilder: PickerBuilderMock,
  },
};
const gapiMock = {
  load: (_name: string, cb: () => void): void => {
    cb();
  },
};
Object.defineProperty(globalThis, 'google', {
  value: googleMock,
  configurable: true,
  writable: true,
});
Object.defineProperty(globalThis, 'gapi', { value: gapiMock, configurable: true, writable: true });

Object.assign(globalThis, logic);

await import('../cloud-google-drive/page.ts');

// ============================================================
// Helpers
// ============================================================

const doc = dom.window.document;
const root = (): HTMLElement => doc.getElementById('root') as HTMLElement;
const q = <T extends Element = Element>(selector: string): T =>
  root().querySelector<T>(selector) as T;

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

async function beginSignIn(): Promise<string> {
  const before = openCount;
  click(q('[data-action="signin"]'));
  await waitFor(() => openCount > before);
  return new URL(lastAuthUrl).searchParams.get('state') ?? '';
}

/** The api.js <script> page.ts injects, if it's currently pending. */
function pendingScript(): HTMLScriptElement | null {
  return doc.head.querySelector<HTMLScriptElement>('script[src*="apis.google.com"]');
}

/** Resolve (or fail) the pending api.js load, then remove it so a later load
 * injects a fresh, detectable one. */
async function settleScript(kind: 'load' | 'error'): Promise<void> {
  await waitFor(() => pendingScript() !== null);
  const script = pendingScript() as HTMLScriptElement;
  script.dispatchEvent(new dom.window.Event(kind));
  script.remove();
}

/** Drive the Picker through to its callback for a given picked file, resolving
 * the api.js load on the first call only. */
async function pick(
  file: { id: string; name: string } | null,
  opts: { load?: boolean } = {},
): Promise<void> {
  const before = pickerShownCount;
  click(q('[data-action="pick"]'));
  if (opts.load) await settleScript('load');
  await waitFor(() => pickerShownCount > before);
  const cb = lastPickerCallback as (data: Record<string, unknown>) => void;
  cb(file === null ? { action: 'cancel' } : { action: 'picked', documents: [file] });
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
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
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

  await t.test('a successful sign-in lands on the file chooser', async () => {
    handlers.token = okJson({ access_token: 'tok' });
    const state = await beginSignIn();
    sendMessage({ type: 'kw-oauth', code: 'auth-code', state, error: null });
    await waitFor(() => q('[data-action="pick"]') !== null);
  });

  await t.test('a Picker that fails to load is reported', async () => {
    click(q('[data-action="pick"]'));
    await settleScript('error');
    await waitFor(() =>
      /Could not load the Google Picker/.test(q('#pick-status').textContent ?? ''),
    );
  });

  await t.test('loading the Picker, then cancelling, changes nothing', async () => {
    await pick(null, { load: true }); // first successful load happens here
    assert.ok(q('[data-action="pick"]'), 'still on the chooser');
  });

  await t.test('picking a file whose download fails by HTTP is reported', async () => {
    handlers.download = errStatus(404);
    await pick({ id: 'f1', name: 'vault.kdbx' }); // Picker already loaded → no script
    await waitFor(() =>
      /Could not open vault.kdbx \(HTTP 404\)/.test(q('#pick-status').textContent ?? ''),
    );
  });

  await t.test('picking a file whose download fails by network is reported', async () => {
    handlers.download = rejects;
    await pick({ id: 'f1', name: 'vault.kdbx' });
    await waitFor(() =>
      /Network error while opening vault.kdbx/.test(q('#pick-status').textContent ?? ''),
    );
  });

  await t.test('picking a file successfully embeds the app', async () => {
    handlers.download = async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new ArrayBuffer(16),
    });
    await pick({ id: 'f1', name: 'vault.kdbx' });
    await waitFor(() => q('#app-frame') !== null);
    assert.equal(q<HTMLElement>('#host-filename').textContent, 'vault.kdbx');
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

  await t.test('kw-save writes back to Drive and reports success', async () => {
    handlers.save = async () => ({ ok: true, status: 200 });
    sendMessage(
      { type: 'kw-save', filename: 'vault.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    await waitFor(() => frameInbox.length === 2);
    assert.deepEqual(frameInbox[1]?.message, { type: 'kw-saved', ok: true });
  });

  await t.test('a Drive write-back HTTP error is reported to the app', async () => {
    handlers.save = errStatus(403);
    sendMessage(
      { type: 'kw-save', filename: 'vault.kdbx', bytes: new ArrayBuffer(8) },
      { source: frameWin },
    );
    await waitFor(() => frameInbox.length === 3);
    assert.deepEqual(frameInbox[2]?.message, { type: 'kw-saved', ok: false, error: 'HTTP 403' });
  });

  await t.test('a Drive write-back network error is reported to the app', async () => {
    handlers.save = rejects;
    sendMessage(
      { type: 'kw-save', filename: 'vault.kdbx', bytes: new ArrayBuffer(8) },
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

  await t.test('back to Drive returns to the chooser, and sign-out returns to sign-in', () => {
    click(q('[data-action="back-to-drive"]'));
    assert.ok(q('[data-action="pick"]'));

    click(q('[data-action="signout"]'));
    assert.ok(q('[data-action="signin"]'));
  });
});
