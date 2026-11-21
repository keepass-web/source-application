/** Real-browser coverage for one-time codes (#138). The jsdom tests compute codes with
 * Node's WebCrypto and lay nothing out; only a real browser shows that its own WebCrypto
 * gives the expected code, and that the copy control sits right before that code on the
 * card, in the table and on the edit screen, at desktop width and on a phone.
 *
 * Date.now is pinned in every frame to RFC 6238's 1234567890, a step boundary, so the
 * code is that test vector's own and holds still for the whole run. What gets copied is
 * asserted in the jsdom tests instead: headless Chrome refuses clipboard writes. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { openApp } from './support/app.ts';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { type KdbxFixture, writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
// RFC 6238's SHA-1 secret, in Base32, and its six-digit code at 1234567890.
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const CODE = '005924';

const CARD = '.detail-field:has(.code-note) .detail-value-wrap';
const CELL = 'td[data-column="otp"] .entry-cell';
const EDIT = '.edit-code';

let server: DistServer;
let browser: Browser;
let fixture: KdbxFixture;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  fixture = await writeKdbxFixture('', [
    { key: 'otp', value: `otpauth://totp/Example:octocat?secret=${SECRET}`, protect: true },
  ]);
});

after(async () => {
  await browser.close();
  await server.close();
});

/** The fixture open in the desktop table, on a page whose clock stands still. */
async function openPinned(): Promise<{ page: Page; app: Frame }> {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    const pinned = 1234567890_000;
    Date.now = () => pinned;
  });
  await page.setViewport({ width: 1280, height: 900 });
  const app = await openApp(page, server.origin, fixture);
  return { page, app };
}

async function showCodeColumn(app: Frame): Promise<void> {
  await app.click('[data-action="toggle-columns"]');
  const offered = await app.$$eval('.column-picker-item', (items) => {
    const input = items
      .find((el) => el.textContent?.trim() === 'One-time code')
      ?.querySelector('input');
    input?.click();
    return Boolean(input);
  });
  // Fails here, not in a later wait for a column that never appears.
  assert.ok(offered, 'the column picker offers One-time code');
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface CodeLayout {
  code: string;
  note: string;
  control: Box | null;
  text: Box | null;
  noteBox: Box | null;
  label: Box | null;
  scope: Box | null;
  pageWidth: number;
}

/** Waits for the code inside `scope`, then measures its parts. */
async function measureCode(app: Frame, scope: string): Promise<CodeLayout> {
  await app.waitForFunction(
    (selector, code) =>
      document.querySelector(selector)?.querySelector('.code-note')?.previousElementSibling
        ?.textContent === code,
    {},
    scope,
    CODE,
  );
  return app.$eval(scope, (el) => {
    const box = (node: Element | null) => {
      const r = node?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
    };
    const noteEl = el.querySelector('.code-note');
    return {
      code: noteEl?.previousElementSibling?.textContent ?? '',
      note: noteEl?.textContent ?? '',
      control: box(el.querySelector('.icon-btn, .copy-hint')),
      text: box(noteEl?.previousElementSibling ?? null),
      noteBox: box(noteEl),
      label: box(el.querySelector('.edit-code-label')),
      scope: box(el),
      pageWidth: document.documentElement.scrollWidth,
    };
  });
}

function assertCopyLeads(layout: CodeLayout, where: string): void {
  const { control, text, noteBox } = layout;
  assert.ok(control && text && noteBox, `${where}: the control, code and note are laid out`);
  assert.equal(layout.code, CODE, `${where}: the code is RFC 6238's`);
  assert.equal(layout.note, '30s', `${where}: with its seconds left`);
  const gap = text.left - control.right;
  assert.ok(gap >= 0 && gap < 10, `${where}: copy sits right before the code, ${gap}px from it`);
  assert.ok(noteBox.left >= text.right, `${where}: and the seconds left follow the code`);
}

test("Chrome's own WebCrypto gives the code, and the card's copy control sits right before it", async () => {
  const { page, app } = await openPinned();
  try {
    await app.click('.entry-table-open button');
    assertCopyLeads(await measureCode(app, CARD), 'the card');
  } finally {
    await page.close();
  }
});

test("once picked, the table's code column puts its copy control at the cell's left edge", async () => {
  const { page, app } = await openPinned();
  try {
    assert.equal(await app.$(CELL), null, 'the column is off until picked');
    await showCodeColumn(app);
    const layout = await measureCode(app, CELL);
    assertCopyLeads(layout, 'the table');
    const edge = (layout.control?.left ?? 0) - (layout.scope?.left ?? 0);
    assert.ok(edge < 1, `the control starts the cell, ${edge}px in from its edge`);
  } finally {
    await page.close();
  }
});

test('the edit screen shows the code under its fields, copy leading it', async () => {
  const { page, app } = await openPinned();
  try {
    await app.click('.entry-table-open button');
    await app.click('[data-action="edit"]');
    const layout = await measureCode(app, EDIT);
    assertCopyLeads(layout, 'the edit screen');
    const fieldsBottom = await app.$eval('#edit-fields', (el) => el.getBoundingClientRect().bottom);
    assert.ok((layout.scope?.top ?? 0) >= fieldsBottom, 'below the fields Save writes');
    assert.ok((layout.label?.right ?? 0) <= (layout.control?.left ?? 0), 'after its label');
  } finally {
    await page.close();
  }
});

test('at phone width the code fits the screen, its copy control still leading it', async () => {
  const { page, app } = await openPinned();
  try {
    await showCodeColumn(app);
    await page.setViewport({ width: 375, height: 900 });
    assertCopyLeads(await measureCode(app, CELL), 'the phone table');

    await app.click('.entry-table-open button');
    const card = await measureCode(app, CARD);
    assertCopyLeads(card, 'the phone card');
    assert.ok((card.scope?.right ?? Number.POSITIVE_INFINITY) <= 375, 'the card row fits');
    assert.ok(card.pageWidth <= 375, `the card does not scroll sideways, ${card.pageWidth}px`);

    await app.click('[data-action="edit"]');
    const edit = await measureCode(app, EDIT);
    assertCopyLeads(edit, 'the phone edit screen');
    assert.ok(
      (edit.label?.bottom ?? Number.POSITIVE_INFINITY) <= (edit.control?.top ?? 0),
      'the label takes a line of its own, as a field label does',
    );
    assert.ok((edit.scope?.right ?? Number.POSITIVE_INFINITY) <= 375, 'the edit row fits');
    assert.ok(
      edit.pageWidth <= 375,
      `the edit screen does not scroll sideways, ${edit.pageWidth}px`,
    );
  } finally {
    await page.close();
  }
});
