/** Auto-lock depends on the embedded app seeing the tab go away — but the app
 * runs in an iframe, and only the top-level tab is ever hidden or shown. That
 * a frame's visibilityState follows its tab is a real-browser fact jsdom has
 * no way to demonstrate, so this drives a second tab in front of the first
 * and waits for the database to lock itself. */
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
// The settings dialog's floor, chosen here so the wait below is ten seconds
// rather than the thirty a fresh session defaults to.
const DELAY_SECONDS = 10;

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

test('a tab left hidden locks the embedded database on its own', async () => {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });

  // waitForSelector can't infer the element type from an id selector.
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the file input exists');
  await fileInput.uploadFile(fixture.path);

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'the app is embedded');
  const frame = await iframeElement.contentFrame();
  assert.ok(frame, 'the iframe has a content frame');

  const passwordInput = await frame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app is on its unlock screen');
  await passwordInput.type(fixture.password);
  await frame.click('#unlock-btn');
  await frame.waitForSelector('.entry-table');

  await frame.click('[data-action="settings"]');
  await frame.waitForFunction(
    () => document.querySelector<HTMLDialogElement>('#dlg-settings')?.open === true,
  );
  const delayInput = (await frame.waitForSelector(
    '#auto-lock-timeout',
  )) as ElementHandle<HTMLInputElement>;
  assert.ok(delayInput, 'the settings dialog offers the auto-lock delay');
  await delayInput.evaluate((el, seconds: number) => {
    el.value = String(seconds);
  }, DELAY_SECONDS);
  await frame.click('#dlg-settings [data-action="save-settings"]');

  // Somewhere else is now in front, so the database's tab is hidden.
  const otherTab = await browser.newPage();
  await otherTab.bringToFront();

  await frame.waitForSelector('#master-password', { timeout: (DELAY_SECONDS + 20) * 1000 });

  await page.bringToFront();
  await otherTab.close();
  assert.equal(
    await page.title(),
    `${basename(fixture.path)} - Locked - KeePass Web - Local file`,
    'and the tab bar shows it locked, without being opened',
  );
});
