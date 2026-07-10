/**
 * Coverage for the connector's popup-callback boot branch: when
 * cloud-google-drive.html is loaded as the OAuth popup (Google redirected it
 * back with ?code=…, and it has an opener), page.ts forwards the result to the
 * opener and closes, rather than rendering the connector UI.
 *
 * That decision runs once at module scope, keyed on window.opener and
 * window.location.search, so it needs its own jsdom (URL carrying the code, a
 * mock opener) and thus its own test file — node:test gives each file a fresh
 * process, so page.ts re-evaluates here independently of the main page test.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as logic from '../cloud-google-drive/logic.ts';

const htmlPath = fileURLToPath(new URL('../cloud-google-drive/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, {
  url: 'https://example.com/cloud-google-drive.html?code=auth-code&state=st-123',
  pretendToBeVisual: true,
});

const openerInbox: Array<{ message: Record<string, unknown>; origin: string }> = [];
const openerMock = {
  postMessage(message: Record<string, unknown>, origin: string): void {
    openerInbox.push({ message, origin });
  },
};
let closed = false;

Object.defineProperty(dom.window, 'opener', { value: openerMock, configurable: true });
Object.defineProperty(dom.window, 'close', {
  value: () => {
    closed = true;
  },
  configurable: true,
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
Object.assign(globalThis, logic);

await import('../cloud-google-drive/page.ts');

test('as an OAuth popup, forwards the result to the opener and closes', () => {
  assert.equal(openerInbox.length, 1);
  assert.deepEqual(openerInbox[0]?.message, {
    type: 'kw-oauth',
    code: 'auth-code',
    state: 'st-123',
    error: null,
  });
  assert.equal(openerInbox[0]?.origin, 'https://example.com');
  assert.equal(closed, true);
  // It did NOT render the connector UI.
  assert.equal(dom.window.document.getElementById('root')?.children.length, 0);
});
