/** Whether a descendant frame's beforeunload actually blocks a top-level
 * reload or back is a real-browser question: the guard lives in the embedded
 * 0x67 app, but the navigation belongs to local.html, and jsdom has no
 * navigation to block. Chrome also only honors the guard once the frame has
 * user activation, which no unit test can produce. */
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

test('an open database makes the browser ask before it reloads the tab', async () => {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });

  // waitForSelector can't infer the element type from an id selector.
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the file input exists');
  await fileInput.uploadFile(fixture.path);

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'the app is embedded');
  const iframeFrame = await iframeElement.contentFrame();
  assert.ok(iframeFrame, 'the iframe has a content frame');

  // Typing and clicking here is also what gives the frame the user activation
  // Chrome requires before honoring its beforeunload at all.
  const passwordInput = await iframeFrame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app is on its unlock screen');
  await passwordInput.type(fixture.password);
  await iframeFrame.click('#unlock-btn');
  await iframeFrame.waitForSelector('.entry-table');

  const prompts: string[] = [];
  page.on('dialog', async (dialog) => {
    prompts.push(dialog.type());
    // Accept, so the reload proceeds and this test never waits on a
    // navigation that was cancelled out from under it.
    await dialog.accept();
  });

  await page.reload({ waitUntil: 'networkidle0' });
  assert.deepEqual(prompts, ['beforeunload'], 'an open database is worth asking about');

  // The reload landed back on an empty chooser, so there is nothing to lose.
  await page.waitForSelector('#drop-zone');
  await page.reload({ waitUntil: 'networkidle0' });
  assert.equal(prompts.length, 1, 'a tab holding no database reloads without a word');
});
