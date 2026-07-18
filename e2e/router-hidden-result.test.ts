/** Regression test: `.result { display: flex }` used to out-rank the
 * browser's `[hidden] { display: none }` default, so #result rendered
 * visible despite carrying the attribute — invisible to jsdom, which never
 * applies CSS. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
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

test('router.html: the #result panel is actually invisible on load, not just marked [hidden]', async () => {
  await page.goto(`${server.origin}/router.html`, { waitUntil: 'networkidle0' });

  const { hasAttribute, renderedHeight } = await page.evaluate(() => {
    const result = document.getElementById('result') as HTMLElement;
    return {
      hasAttribute: result.hasAttribute('hidden'),
      renderedHeight: result.getBoundingClientRect().height,
    };
  });

  assert.equal(
    hasAttribute,
    true,
    'the hidden attribute is present (this half jsdom already covers correctly)',
  );
  assert.equal(
    renderedHeight,
    0,
    'a [hidden] element must actually render with zero height — a class-driven ' +
      'display value can silently out-rank the browser default and leave it visible',
  );
});
