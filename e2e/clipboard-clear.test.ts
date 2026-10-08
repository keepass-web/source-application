/** The copied value is wiped on a timer, but Chrome refuses a clipboard write
 * from a document without focus, and by the time the timer runs out the user
 * has usually gone elsewhere to paste (#88). jsdom has no focus to refuse
 * with, so this drives a real one: copy, put another tab in front past the
 * timeout, then come back.
 *
 * Headless Chrome keeps a clipboard of its own rather than the machine's, so
 * granting it access here touches nothing outside the browser. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Frame, type Page } from 'puppeteer-core';
import { openApp } from './support/app.ts';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
// The settings dialog's floor, so the wait below is five seconds rather than thirty.
const DELAY_SECONDS = 5;
// A hidden tab paints nothing, so waits on it poll on a clock instead of on frames.
const POLL_MS = 100;

let server: DistServer;
let browser: Browser;
let page: Page;
let app: Frame;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  await browser
    .defaultBrowserContext()
    .overridePermissions(server.origin, [
      'clipboard-read',
      'clipboard-write',
      'clipboard-sanitized-write',
    ]);
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  app = await openApp(page, server.origin, await writeKdbxFixture());
});

after(async () => {
  await browser.close();
  await server.close();
});

const readClipboard = (target: Page | Frame): Promise<string> =>
  target.evaluate(() => navigator.clipboard.readText());

const countdown = (): Promise<string | null | undefined> =>
  app.$eval('#toast-countdown', (el) => el.textContent);

test('a clear refused while the user is away goes through when they return', async () => {
  await app.click('[data-action="settings"]');
  const delayInput = (await app.waitForSelector(
    '#clipboard-timeout',
  )) as ElementHandle<HTMLInputElement>;
  await delayInput.evaluate((el, seconds: number) => {
    el.value = String(seconds);
  }, DELAY_SECONDS);
  await app.click('#dlg-settings [data-action="save-settings"]');

  await app.click('[data-action="view-table"]');
  const copyHint = await app.waitForSelector(
    '.entry-table tbody td .copy-hint[title="Copy username"]',
  );
  assert.ok(copyHint, 'the username cell carries a copy control');
  await copyHint.click();
  await app.waitForFunction(() => document.getElementById('toast')?.hidden === false);
  assert.equal(await readClipboard(app), 'octocat');
  assert.match((await countdown()) ?? '', /^clears in [1-5]s$/, 'it counts down to the clear');

  // Somewhere else is now in front, so this document has lost focus.
  const otherTab = await browser.newPage();
  await otherTab.goto(`${server.origin}/index.html`);
  await otherTab.bringToFront();
  await app.waitForFunction(
    () =>
      document.getElementById('toast-countdown')?.textContent ===
      'clears when you next click or type',
    { polling: POLL_MS, timeout: (DELAY_SECONDS + 20) * 1000 },
  );
  assert.equal(await readClipboard(otherTab), 'octocat', 'the browser refused the clear');

  await page.bringToFront();
  await otherTab.close();
  await app.waitForFunction(() => document.getElementById('toast')?.hidden === true, {
    polling: POLL_MS,
  });
  assert.equal(await readClipboard(app), '', 'and allowed it once the user was back');
});
