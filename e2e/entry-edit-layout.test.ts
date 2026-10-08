/** Real-browser coverage for the entry edit and detail screens' layout (#89).
 * jsdom has no layout engine, so only a real browser can show that the screens
 * take the width they are given, that a field's buttons sit close together,
 * that a phone puts each label on its own line above the value, and that saved
 * notes still show the lines they were written in. */
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
  fixture = await writeKdbxFixture();
});

after(async () => {
  await browser.close();
  await server.close();
});

/** Opens a fresh new-entry screen at the given viewport width. */
async function newEntryAt(width: number): Promise<{ page: Page; app: Frame }> {
  const page = await browser.newPage();
  await page.setViewport({ width, height: 900 });
  const app = await openApp(page, server.origin, fixture);
  await app.click('[data-action="add-entry"]');
  await app.waitForSelector('#edit-fields .edit-field');
  return { page, app };
}

/** The bounding boxes of one standard field's label, value, and buttons. */
function measureRow(app: Frame, key: string) {
  return app.$$eval(
    '.edit-field',
    (rows, wanted) => {
      const row = rows.find(
        (r) => r.querySelector<HTMLInputElement>('.edit-key')?.value === wanted,
      );
      const box = (el: Element | null | undefined) => {
        const r = el?.getBoundingClientRect();
        return r
          ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
          : null;
      };
      return {
        key: box(row?.querySelector('.edit-key')),
        value: box(row?.querySelector('.edit-value')),
        buttons: Array.from(row?.querySelectorAll('.icon-btn') ?? []).map((b) => box(b)),
      };
    },
    key,
  );
}

test('the edit screen uses the width it is given, and a field keeps its buttons together', async () => {
  const { page, app } = await newEntryAt(1280);
  try {
    const screenWidth = await app.$eval('.screen-edit', (el) => el.getBoundingClientRect().width);
    assert.equal(Math.round(screenWidth), 640, 'up to its 640px cap, not just its content');

    const password = await measureRow(app, 'Password');
    assert.ok(password.value && password.value.width > 300, 'the value has room to be read');
    assert.equal(password.buttons.length, 3, 'reveal, copy, generate');
    for (let i = 1; i < password.buttons.length; i++) {
      const gap = (password.buttons[i]?.left ?? 0) - (password.buttons[i - 1]?.right ?? 0);
      assert.ok(gap < 2, `adjacent buttons touch, ${gap}px apart`);
    }

    const focused = await app.evaluate(
      () =>
        document.activeElement?.closest('.edit-field')?.querySelector<HTMLInputElement>('.edit-key')
          ?.value,
    );
    assert.equal(focused, 'Title', 'a new entry starts in its title');
  } finally {
    await page.close();
  }
});

test('at phone width a field puts its label above the value', async () => {
  const { page, app } = await newEntryAt(375);
  try {
    const title = await measureRow(app, 'Title');
    assert.ok(title.key && title.value, 'the title row is laid out');
    assert.ok(title.key.bottom <= title.value.top, 'the label sits on a line of its own');
    assert.ok(title.value.width > 200, `and the value gets the row, ${title.value.width}px of it`);
  } finally {
    await page.close();
  }
});

test('a saved entry shows its notes line by line, at full width', async () => {
  const { page, app } = await newEntryAt(1280);
  try {
    await app.type('#edit-fields .edit-value', 'Multi-line');
    await app.type('textarea.edit-value', 'first line\nsecond line');
    await app.click('[data-action="save"]');
    await app.waitForSelector('#detail-title');

    const screenWidth = await app.$eval('.screen-detail', (el) => el.getBoundingClientRect().width);
    assert.equal(Math.round(screenWidth), 640, 'the detail screen fills its cap too');

    const heights = await app.$$eval('.detail-field', (rows) => {
      const heightOf = (label: string) =>
        rows
          .find((r) => r.querySelector('.detail-label')?.textContent === label)
          ?.querySelector('.detail-value')
          ?.getBoundingClientRect().height ?? 0;
      return { title: heightOf('Title'), notes: heightOf('Notes') };
    });
    assert.ok(
      heights.notes > heights.title * 1.8,
      `two lines of notes stand twice as tall as the one-line title, ${heights.notes}px to ${heights.title}px`,
    );
  } finally {
    await page.close();
  }
});
