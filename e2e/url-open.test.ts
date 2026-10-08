/** Opening an entry's URL in a new tab (#86), from inside the embedded app.
 * Only a real browser decides whether a frame may open a tab on a click, and
 * whether noopener and noreferrer really cut the new tab off from this one.
 * The entry points at this test's own server, so nothing leaves the machine. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Frame, type Page } from 'puppeteer-core';
import { openApp } from './support/app.ts';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

let server: DistServer;
let browser: Browser;
let page: Page;
let app: Frame;
let address: string;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  address = `${server.origin}/index.html`;
  app = await openApp(page, server.origin, await writeKdbxFixture(address));
  await app.click('[data-action="view-table"]');
  await app.waitForSelector('.entry-table');
});

after(async () => {
  await browser.close();
  await server.close();
});

test('the URL column opens the address in a new tab that cannot reach back', async () => {
  const opened = browser.waitForTarget((target) => target.url() === address);
  await app.click('.entry-table .open-hint');
  const tab = await (await opened).page();
  assert.ok(tab, 'a new tab opened at the address');
  assert.equal(await tab.evaluate(() => window.opener), null, 'with no handle back to the app');
  assert.equal(await tab.evaluate(() => document.referrer), '', 'nor word of where it came from');
  await tab.close();
});
