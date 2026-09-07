/** Real-browser coverage for the entry table's controls (issue #67). jsdom
 * dispatches events straight at an element; only a real browser hit-tests a
 * coordinate, so this is what proves the cells and the open control are
 * actually clickable where they render.
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
      const cell = cells.find((c) => c.firstChild?.textContent === name);
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
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(await app.$('#detail-title'), null, 'the card stayed shut');
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
