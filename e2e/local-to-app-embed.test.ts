/** Real, navigation-free handoff from local.html to the embedded 0x67 app —
 * jsdom tests each page in isolation and can't exercise a real iframe.
 *
 * Regression coverage for the fix that replaced router.html's link-based
 * handoff — which discarded the File object on navigation, forcing the user
 * to reselect the same file on 0x67.html's own upload screen — with an
 * in-page iframe embed that hands the already-read bytes straight to the app
 * over postMessage. */
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

test('dropping a file on local.html embeds a working 0x67 app that unlocks the same file, with no reselection', async () => {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });

  // waitForSelector can't infer the element type from an id selector.
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the file input exists');
  await fileInput.uploadFile(fixture.path);

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'a recognized file embeds the app in an iframe');
  assert.equal(
    page.url(),
    `${server.origin}/local.html`,
    'still on local.html — recognizing the file did not navigate away',
  );

  const iframeFrame = await iframeElement.contentFrame();
  assert.ok(iframeFrame, 'the iframe has a content frame');

  // No second file input here: the bytes local.html already read are handed
  // straight to the embedded app, so it opens directly on its unlock screen.
  const passwordInput = await iframeFrame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app went straight to its unlock screen');
  await passwordInput.type(fixture.password);
  await iframeFrame.click('#unlock-btn');

  await iframeFrame.waitForSelector('.entry-table');
  const titleText = await iframeFrame.$eval('.entry-table-title', (el) => el.textContent);
  assert.ok(
    titleText?.includes(fixture.entryTitle),
    `unlocked vault shows the fixture entry, got "${titleText}"`,
  );
});

test('clicking "Create a new database" on local.html embeds the app straight on its create-database screen', async () => {
  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });

  await page.click('[data-action="create-database"]');

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'the app is embedded with nothing to open');
  const iframeFrame = await iframeElement.contentFrame();
  assert.ok(iframeFrame, 'the iframe has a content frame');

  // kw-create overrides the embedded app's own upload screen with its
  // create-database screen — no unlock screen, and no second file picker.
  const nameInput = (await iframeFrame.waitForSelector(
    '#create-name',
  )) as ElementHandle<HTMLInputElement>;
  assert.equal(await iframeFrame.$('#drop-zone'), null, 'no longer on the upload screen');
  assert.equal(await iframeFrame.$('#master-password'), null, 'no unlock screen ever shown');

  await nameInput.evaluate((el) => {
    el.value = '';
  });
  await nameInput.type('E2E Created Vault');
  await iframeFrame.type('#create-password', 'e2e-create-password');
  await iframeFrame.type('#create-password-confirm', 'e2e-create-password');
  await iframeFrame.click('#create-btn');

  await iframeFrame.waitForSelector('.entry-empty');
  const panelTitle = await iframeFrame.$eval('#panel-title', (el) => el.textContent);
  assert.equal(panelTitle, 'E2E Created Vault', 'lands on the new, empty database');
});
