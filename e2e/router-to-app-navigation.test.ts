/**
 * Real cross-document navigation: dropping a file on router.html, following
 * its real "Open" link — an actual browser navigation triggered by a real
 * click, not a jsdom-simulated event — and confirming 0x67.html actually
 * boots on the far side.
 *
 * router.html's "Open" link is a plain `href="0x67.html"` with no handoff
 * mechanism (no query string, no sessionStorage, no postMessage) — it only
 * ever sniffs the file's first 8 bytes to decide which page can read it, per
 * router/logic.ts's identifyFormat. The file itself never crosses the
 * navigation, so the user selects it again on 0x67.html's own upload screen —
 * this test does the same, then unlocks, to confirm that boot actually works
 * once real navigation (not a fresh module import, which is what the jsdom
 * suite does for each page in isolation) has happened first.
 */
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

  // waitForSelector infers an element type from the selector's leading tag
  // name, which an id selector doesn't have — assert the real type by hand.
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

  // router.html only sniffed the header — it never handed the file itself
  // across the navigation, so 0x67.html boots to its own upload screen and
  // the same file is selected again here.
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
