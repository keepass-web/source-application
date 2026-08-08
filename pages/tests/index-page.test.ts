import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { must, verifyCommand } from '../index/logic.ts';

const htmlPath = fileURLToPath(new URL('../index/page.html', import.meta.url));
const html = readFileSync(htmlPath, 'utf8');
const dom = new JSDOM(html, { url: 'https://keepass-web.app/index.html' });

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
Object.assign(globalThis, { must, verifyCommand });

await import('../index/page.ts');

test('fills in the verify command for the page origin', () => {
  const code = dom.window.document.getElementById('verify-command');
  assert.equal(
    code?.textContent,
    'curl -O https://keepass-web.app/index.html\ngh attestation verify index.html --repo keepass-web/source-application',
  );
});
