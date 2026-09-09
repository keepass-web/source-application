/**
 * Tests for shared/logic.ts, the tab chrome every page that can hold a
 * database goes through (issue #73). It touches a Document but never reaches
 * for a global one, so a plain jsdom document passed in is enough — no page
 * markup, no bundle, no boot sequence.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { applyTabState, tabTitle } from '../shared/logic.ts';

const PAGE_ICON = 'data:image/svg+xml,%3Csvg/%3E';

function pageDocument(withIcon = true): Document {
  const icon = withIcon ? `<link rel="icon" type="image/svg+xml" href="${PAGE_ICON}">` : '';
  const dom = new JSDOM(
    `<!DOCTYPE html><html><head>${icon}<title>Base</title></head><body></body></html>`,
  );
  return dom.window.document as unknown as Document;
}

const iconHref = (doc: Document): string =>
  doc.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '';

test('the title names the database and spells its state out', () => {
  assert.equal(tabTitle('KeePass Web', 'vault.kdbx', true), 'vault.kdbx - Locked - KeePass Web');
  assert.equal(tabTitle('KeePass Web', 'vault.kdbx', false), 'vault.kdbx - Unlocked - KeePass Web');
});

test('the title never repeats the state as a padlock glyph', () => {
  for (const locked of [true, false]) {
    const title = tabTitle('KeePass Web', 'vault.kdbx', locked);
    assert.ok(!title.includes('\u{1F512}') && !title.includes('\u{1F513}'), title);
  }
});

test('no database means the page keeps its own name', () => {
  assert.equal(tabTitle('KeePass Web - Local file', '', true), 'KeePass Web - Local file');
  assert.equal(tabTitle('KeePass Web - Local file', '', false), 'KeePass Web - Local file');
});

test('the icon tracks the lock state and hands the page its own back', () => {
  const doc = pageDocument();

  applyTabState(doc, 'Base', 'vault.kdbx', true);
  const locked = iconHref(doc);
  assert.equal(doc.title, 'vault.kdbx - Locked - Base');
  assert.notEqual(locked, PAGE_ICON, 'a held database is not the page at rest');

  applyTabState(doc, 'Base', 'vault.kdbx', false);
  const unlocked = iconHref(doc);
  assert.equal(doc.title, 'vault.kdbx - Unlocked - Base');
  assert.notEqual(unlocked, locked, 'and the two states are not the same icon');

  // Hue and glyph are what carry at 16px, so the two must differ in both.
  assert.ok(locked.includes('%230e7c5a') && locked.includes('M6 8.4V7'), 'accent, with a padlock');
  assert.ok(unlocked.includes('%238a5a1e') && !unlocked.includes('M6 8.4V7'), 'warning, with rows');

  applyTabState(doc, 'Base', '', true);
  assert.equal(doc.title, 'Base');
  assert.equal(iconHref(doc), PAGE_ICON, 'closing gives the page its own icon back');
});

test('a page whose icon link carries no href still gets one back', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><head><link rel="icon"></head><body></body></html>');
  const doc = dom.window.document as unknown as Document;

  applyTabState(doc, 'Base', 'vault.kdbx', true);
  assert.notEqual(iconHref(doc), '', 'the locked icon still goes on');

  applyTabState(doc, 'Base', '', true);
  assert.equal(iconHref(doc), '', 'and it comes back off, leaving nothing behind');
});

test('a page with no icon link is titled anyway, not crashed', () => {
  const doc = pageDocument(false);
  applyTabState(doc, 'Base', 'vault.kdbx', true);
  assert.equal(doc.title, 'vault.kdbx - Locked - Base');
  assert.equal(doc.querySelector('link[rel="icon"]'), null);
});
