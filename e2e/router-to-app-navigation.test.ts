/** Real navigation from router.html to 0x67.html via a real link click —
 * jsdom tests each page in isolation and can't exercise this. The "Open"
 * link carries no handoff, so the file is selected again on the far side,
 * same as a real user would. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

let server: DistServer;
let browser: Browser;
let page: Page;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
  await server.close();
});

test('dropping a file on the router, then following its real "Open" link, boots a working 0x67.html that unlocks the same file', async () => {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/router.html`, { waitUntil: 'networkidle0' });

  // waitForSelector can't infer the element type from an id selector.
  const routerFileInput = (await page.waitForSelector(
    '#file-input',
  )) as ElementHandle<HTMLInputElement>;
  assert.ok(routerFileInput, 'the file input exists');
  await routerFileInput.uploadFile(fixture.path);

  const openLink = await page.waitForSelector('#result-link:not([hidden])');
  assert.ok(openLink, 'a real, visible "Open" link appears once the format is recognized');
  const href = await openLink.evaluate((el) => el.getAttribute('href'));
  assert.equal(href, '0x67.html');

  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle0' }), openLink.click()]);

  assert.ok(page.url().endsWith('/0x67.html'), `expected to land on 0x67.html, got ${page.url()}`);

  // No handoff — select the same file again on 0x67.html's own upload screen.
  const appFileInput = (await page.waitForSelector(
    '#file-input',
  )) as ElementHandle<HTMLInputElement>;
  await appFileInput.uploadFile(fixture.path);

  const passwordInput = await page.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the unlock screen rendered on the newly-navigated document');
  await passwordInput.type(fixture.password);
  await page.click('#unlock-btn');

  await page.waitForSelector('.entry-row');
  const titleText = await page.$eval('.entry-row-title', (el) => el.textContent);
  assert.ok(
    titleText?.includes(fixture.entryTitle),
    `unlocked vault shows the fixture entry, got "${titleText}"`,
  );
});
