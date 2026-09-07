/** The tab title belongs to local.html, but only the embedded 0x67 app knows
 * which database is open and whether it is locked — so the title is right
 * only if a real cross-document postMessage is delivered and handled. The
 * jsdom suites test each page in its own isolated window and cannot show
 * that; this drives the built distributables in Chrome, where the two
 * documents really are separate. */
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
const BASE_TITLE = 'KeePass Web - Local file';

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

/** The title lands a turn after the DOM change that triggers it, once the
 * iframe's message has crossed to the host. On timeout, re-assert so the
 * failure names the title that was actually there instead of just "timed out". */
async function waitForTitle(expected: string): Promise<void> {
  try {
    await page.waitForFunction(
      (want: string) => document.title === want,
      { timeout: 5000 },
      expected,
    );
  } catch {
    assert.equal(await page.title(), expected);
  }
}

test('the tab names the open database and tracks its lock state', async () => {
  const fixture = await writeKdbxFixture();
  const filename = basename(fixture.path);

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
  assert.equal(await page.title(), BASE_TITLE, 'nothing open, so the tab is just this page');

  // waitForSelector can't infer the element type from an id selector.
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the file input exists');
  await fileInput.uploadFile(fixture.path);

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'a recognized file embeds the app in an iframe');
  const iframeFrame = await iframeElement.contentFrame();
  assert.ok(iframeFrame, 'the iframe has a content frame');

  await waitForTitle(`🔒 ${filename} - ${BASE_TITLE}`);

  const passwordInput = await iframeFrame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app went straight to its unlock screen');
  await passwordInput.type(fixture.password);
  await iframeFrame.click('#unlock-btn');

  await iframeFrame.waitForSelector('.entry-table');
  await waitForTitle(`🔓 ${filename} - ${BASE_TITLE}`);

  // Nothing is unsaved, so the app acks the close request immediately.
  await page.click('[data-action="back-to-chooser"]');
  await page.waitForSelector('#drop-zone');
  await waitForTitle(BASE_TITLE);
});
