/** Real-browser coverage for the table's copy gesture (issue #67). Pointer
 * capture is a no-op in jsdom, so a release routed back to the cell is only
 * observable here — which is what keeps a tap from becoming a hold.
 *
 * What is copied is asserted in the jsdom tests instead: headless Chrome
 * refuses `navigator.clipboard.writeText` outright ("Write permission denied")
 * even with the permission overridden, so the toast never appears here. */
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

test('a tap copies without opening the entry, even past the hold delay', async () => {
  const { x, y } = await usernameCellCentre();
  await page.mouse.click(x, y);

  // Past the threshold: had the release not reached the cell, the pending
  // hold timer would open the card right about here.
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(await app.$('#detail-title'), null, 'the card stayed shut');
});

test('releasing outside the cell abandons the press rather than opening the entry', async () => {
  const { x, y } = await usernameCellCentre();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 300, y + 200, { steps: 4 });
  await page.mouse.up();

  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(await app.$('#detail-title'), null, 'dragging off the cell opened nothing');
});

test('holding the cell opens the entry instead', async () => {
  const { x, y } = await usernameCellCentre();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await new Promise((resolve) => setTimeout(resolve, 700));
  await page.mouse.up();

  const title = await app.waitForSelector('#detail-title');
  assert.ok(title, 'the card opened');
  assert.match(
    (await title.evaluate((el) => el.textContent)) ?? '',
    /Example Entry/,
    'and it is the entry that was held',
  );
});
