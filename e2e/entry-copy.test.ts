/** Real-browser coverage for the entry table's controls (issues #67, #76,
 * #77). jsdom dispatches events straight at an element and has no layout
 * engine at all; only a real browser hit-tests a coordinate and gives a cell
 * or a column a width, so this is what proves the controls are clickable where
 * they render, that the copy control holds the cell's right edge, and that a
 * dragged column actually changes size.
 *
 * What gets copied is asserted in the jsdom tests instead: headless Chrome
 * refuses `navigator.clipboard.writeText` outright ("Write permission denied"),
 * so no toast ever appears here. */
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
let page: Page;
let app: Frame;
let fixture: KdbxFixture;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  fixture = await writeKdbxFixture();
  app = await openApp(page, server.origin, fixture);
  await app.click('[data-action="view-table"]');
  await app.waitForSelector('.entry-table');
});

after(async () => {
  await browser.close();
  await server.close();
});

/** Centre of the cell holding the fixture entry's username. */
async function usernameCellCentre(): Promise<{ x: number; y: number }> {
  const box = await app.$$eval(
    '.entry-table tbody td',
    (cells, name) => {
      const cell = cells.find((c) => c.querySelector('.entry-cell-text')?.textContent === name);
      if (!cell) return null;
      const rect = cell.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    },
    'octocat',
  );
  assert.ok(box, 'the username cell is on screen');
  const frameBox = await (await app.frameElement())?.boundingBox();
  assert.ok(frameBox, 'the app frame is laid out');
  return { x: frameBox.x + box.x, y: frameBox.y + box.y };
}

test('clicking a value never opens the entry', async () => {
  const { x, y } = await usernameCellCentre();
  await page.mouse.click(x, y);
  // Opening is synchronous now, so there is nothing to wait out.
  assert.equal(await app.$('#detail-title'), null, 'the card stayed shut');
});

test('the copy control holds the right edge of its cell', async () => {
  const geometry = await app.$$eval(
    '.entry-table tbody td',
    (cells, name) => {
      const cell = cells.find((c) => c.querySelector('.entry-cell-text')?.textContent === name);
      const hint = cell?.querySelector('.copy-hint');
      const text = cell?.querySelector('.entry-cell-text');
      if (!cell || !hint || !text) return null;
      const inner = cell.querySelector('.entry-cell') as HTMLElement;
      return {
        gapToTheRightEdge: inner.getBoundingClientRect().right - hint.getBoundingClientRect().right,
        gapAfterTheText: hint.getBoundingClientRect().left - text.getBoundingClientRect().right,
      };
    },
    'octocat',
  );
  assert.ok(geometry, 'the username cell carries both a text box and a copy control');

  assert.ok(
    geometry.gapToTheRightEdge < 1,
    `the control sits at the cell's right edge, ${geometry.gapToTheRightEdge}px short of it`,
  );
  // A short value leaves room, and the control does not follow the text into it.
  assert.ok(
    geometry.gapAfterTheText > 8,
    `it is pinned there rather than trailing the text, ${geometry.gapAfterTheText}px behind it`,
  );
});

test('dragging a column header changes that column width', async () => {
  const handle = await app.$('th[data-column="username"] .col-resize');
  assert.ok(handle, 'every resizable column carries a handle');

  const widthOf = (): Promise<number> =>
    app.$eval('th[data-column="username"]', (th) => th.getBoundingClientRect().width);
  const before = await widthOf();

  const box = await handle.boundingBox();
  assert.ok(box, 'the handle is laid out');
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, y);
  await page.mouse.up();

  const after = await widthOf();
  assert.ok(after > before + 60, `the column widened, from ${before}px to ${after}px`);
  assert.equal(
    await app.$eval('th[data-column="username"] .col-resize', (el) =>
      el.getAttribute('aria-valuenow'),
    ),
    String(Math.round(after)),
    'and says so to anyone reading it out',
  );
});

test('the row control is the way into the card', async () => {
  const openButton = await app.$('.entry-table-open button');
  assert.ok(openButton, 'every row carries one');
  await openButton.click();

  const title = await app.waitForSelector('#detail-title');
  assert.ok(title, 'the card opened');
  assert.match(
    (await title.evaluate((el) => el.textContent)) ?? '',
    /Example Entry/,
    'and it is the row that was clicked',
  );
});
