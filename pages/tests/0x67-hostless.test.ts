/**
 * Coverage for 0x67/page.ts when it is framed but no host ever answers — a
 * page embedded by something that doesn't speak the protocol, a sandboxed
 * frame, or a host whose script threw before it could reply (#83).
 *
 * 0x67-host.test.ts boots a framed copy whose parent does answer, and
 * 0x67-page.test.ts boots an unframed one; neither reaches the path where the
 * handshake goes unanswered. node:test runs each file in its own process, so
 * importing page.ts here re-evaluates its module scope independently.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import * as embedProtocol from '../../packages/embed-protocol/src/index.ts';
import * as logic from '../0x67/logic.ts';
import { applyTabState } from '../shared/logic.ts';

const htmlPath = fileURLToPath(new URL('../0x67/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://example.com/keepass/', pretendToBeVisual: true });

// A parent that records what it is told and never replies.
const hostInbox: Array<{ message: Record<string, unknown>; origin: string }> = [];
const silentParent = {
  postMessage(message: Record<string, unknown>, origin: string): void {
    hostInbox.push({ message, origin });
  },
};

Object.defineProperty(dom.window, 'parent', { value: silentParent, configurable: true });
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

Object.assign(globalThis, { applyTabState, ...embedProtocol, ...logic });

const doc = dom.window.document;
const baseTitle = doc.title;

await import('../0x67/page.ts');

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the grace period');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test('0x67 framed by a host that never answers', async (t) => {
  await t.test('announces itself once and shows the upload screen', () => {
    assert.deepEqual(hostInbox.at(-1)?.message, { type: 'kw-ready' });
    assert.equal(hostInbox.length, 1);
    assert.ok(doc.getElementById('root')?.querySelector('#drop-zone'), 'usable, not blank');
  });

  await t.test('takes its own tab state once the grace period passes', async () => {
    // Proves the title went to this document rather than to a host that isn't
    // there: nothing can restore it except publishTitle's standalone branch.
    doc.title = 'not the base title';
    await waitFor(() => doc.title === baseTitle);
    assert.equal(hostInbox.length, 1, 'still nothing posted to the absent host');
  });
});
