/**
 * Tests for shared/footer.html, the partial every page inlines (issue #116).
 * Following a footer link must not take the visitor away from the page they
 * are on, nor hand the destination a reference or a referrer back to it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../shared/footer.html', import.meta.url));
const links = JSDOM.fragment(readFileSync(htmlPath, 'utf8')).querySelectorAll('a');

test('every footer link opens in a new tab, cut off from this one', () => {
  assert.ok(links.length > 0, 'the footer has links');
  for (const link of links) {
    assert.equal(link.target, '_blank', link.href);
    assert.ok(link.relList.contains('noopener'), link.href);
    assert.ok(link.relList.contains('noreferrer'), link.href);
  }
});
