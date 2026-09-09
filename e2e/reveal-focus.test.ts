/** The caret has to survive a click on a control that acts on the field it
 * sits beside (issue #72). jsdom never moves focus on a press at all, so the
 * pages suite can only assert that the press is cancelled; a real browser is
 * the only place the focus move it prevents actually happens. The unlock
 * screen's reveal toggle stands in for the entry-edit row's controls too —
 * all of them go through the same helper. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Frame, type Page } from 'puppeteer-core';
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

test('revealing the master password leaves the caret in the field', async () => {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the chooser offers a file input');
  await fileInput.uploadFile(fixture.path);

  const frameElement = await page.waitForSelector('#app-frame');
  assert.ok(frameElement, 'the app is embedded in an iframe');
  const app = (await frameElement.contentFrame()) as Frame;

  // Stop at the unlock screen: this is about typing a password, not reading a database.
  const passwordInput = await app.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app shows its unlock screen');
  await passwordInput.type('half-typed');

  await app.click('[data-action="toggle-password"]');

  const state = await app.evaluate(() => ({
    focused: document.activeElement?.id ?? '',
    type: (document.getElementById('master-password') as HTMLInputElement).type,
    value: (document.getElementById('master-password') as HTMLInputElement).value,
  }));

  assert.equal(state.focused, 'master-password', 'the field kept focus, so typing carries on');
  assert.equal(state.type, 'text', 'and the toggle still revealed the password');
  assert.equal(state.value, 'half-typed', 'without disturbing what was already typed');
});
