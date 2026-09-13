/** The same local.html -> 0x67 handoff, driven from disk instead of a server.
 * Running the downloaded files straight off the filesystem is one of the two
 * supported ways to use the app, and every other suite here reaches dist/ over
 * HTTP, so nothing else can see a break that only happens on file:// (#83).
 *
 * Chrome gives each file:// document its own opaque origin: location.origin
 * reads "file://" while messages arrive as "null", so a contract naming a tuple
 * origin never delivers. Each test below is something that silently did nothing
 * while that was true. */
import assert from 'node:assert/strict';
import { basename, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { resolveChromePath } from './support/chrome.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const localFileUrl = pathToFileURL(join(distDir, 'local.html')).href;
const BASE_TITLE = 'KeePass Web - Local file';

let browser: Browser;
let page: Page;

before(async () => {
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    // Deliberately no --allow-file-access-from-files: default flags are the
    // configuration a downloaded copy actually runs under.
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
});

after(async () => {
  await browser.close();
});

async function embedFixture() {
  const fixture = await writeKdbxFixture();
  await page.goto(localFileUrl, { waitUntil: 'networkidle0' });

  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the file input exists');
  await fileInput.uploadFile(fixture.path);

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'a recognized file embeds the app in an iframe');
  const app = await iframeElement.contentFrame();
  assert.ok(app, 'the iframe has a content frame');
  return { app, filename: basename(fixture.path), password: fixture.password };
}

test('opened from disk, the handoff still arrives and the file is not chosen twice', async () => {
  const { app, password } = await embedFixture();

  const passwordInput = await app.waitForSelector('#master-password', { timeout: 5000 });
  assert.ok(passwordInput, 'the embedded app went straight to its unlock screen');
  assert.equal(await app.$('#drop-zone'), null, 'no second file picker inside the frame');

  await passwordInput.type(password);
  await app.click('#unlock-btn');
  await app.waitForSelector('.entry-table');
});

test('opened from disk, the tab names the open database and its lock state', async () => {
  const { app, filename, password } = await embedFixture();

  await page.waitForFunction(
    (want: string) => document.title === want,
    { timeout: 5000 },
    `${filename} - Locked - ${BASE_TITLE}`,
  );

  const passwordInput = await app.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the app shows its unlock screen');
  await passwordInput.type(password);
  await app.click('#unlock-btn');
  await app.waitForSelector('.entry-table');

  await page.waitForFunction(
    (want: string) => document.title === want,
    { timeout: 5000 },
    `${filename} - Unlocked - ${BASE_TITLE}`,
  );
});

test('opened from disk, find reaches the app from the host chrome', async () => {
  const { app, password } = await embedFixture();

  const passwordInput = await app.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the app shows its unlock screen');
  await passwordInput.type(password);
  await app.click('#unlock-btn');
  await app.waitForSelector('.entry-table');

  // Focus stays on the host, never inside the frame: clicking into the app
  // first is what makes this pass against a build where the handoff is dead,
  // because the app's own keydown handler would then catch the keystroke.
  await page.click('#host-filename');
  await app.$eval('#search-input', (el) => (el as HTMLElement).blur());
  assert.notEqual(
    await app.evaluate(() => document.activeElement?.id),
    'search-input',
    'focus really is off the search field to begin with',
  );

  await page.keyboard.down('Control');
  await page.keyboard.press('f');
  await page.keyboard.up('Control');

  await app.waitForFunction(() => document.activeElement?.id === 'search-input');
});

test('opened from disk, back to chooser completes instead of hanging', async () => {
  const { app, password } = await embedFixture();

  const passwordInput = await app.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the app shows its unlock screen');
  await passwordInput.type(password);
  await app.click('#unlock-btn');
  await app.waitForSelector('.entry-table');

  await page.click('[data-action="back-to-chooser"]');

  // An open database is worth a question, and the app asks it inside the
  // frame — so this exercises the whole round trip: the request crosses, the
  // app asks, and the user's answer crosses back as kw-close.
  const confirm = await app.waitForSelector(
    '#dlg-confirm-discard [data-action="confirm-discard"]',
    {
      timeout: 5000,
    },
  );
  assert.ok(confirm, 'the app asked before letting go of the database');
  await confirm.click();

  await page.waitForSelector('#drop-zone', { timeout: 5000 });
  assert.equal(await page.$('#app-frame'), null, 'the iframe is gone');
  assert.equal(await page.title(), BASE_TITLE, 'the tab is this page again');
});
