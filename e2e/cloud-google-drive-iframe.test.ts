/** Regression coverage for the iframe-collapse and double-footer bugs — both
 * invisible to jsdom, which has no layout engine. Reaches the embedded-app
 * screen by cloning tpl-host directly rather than the real OAuth flow, which
 * needs live credentials this suite doesn't have. */
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
    args: ['--no-sandbox'], // some CI containers need this even for non-root
  });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
  await server.close();
});

test('embedded 0x67 iframe fills its container, and its own footer stays hidden', async () => {
  await page.goto(`${server.origin}/cloud-google-drive.html`, { waitUntil: 'networkidle0' });

  await page.evaluate(() => {
    const root = document.getElementById('root') as HTMLElement;
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-host') as HTMLTemplateElement;
    root.appendChild(tpl.content.cloneNode(true));
    (document.getElementById('host-filename') as HTMLElement).textContent = 'Stavvy.kdbx';
    (document.getElementById('app-frame') as HTMLIFrameElement).src = '0x67.html';
  });

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'the embedded app iframe renders');
  const iframeFrame = await iframeElement.contentFrame();
  assert.ok(iframeFrame, 'the iframe has a content frame');
  await iframeFrame.waitForSelector('.wordmark'); // confirms it actually rendered, not just started loading

  // Should fill the space left over after every fixed-size sibling, not
  // collapse to Chrome's small intrinsic default.
  const { frameHeight, availableHeight } = await page.evaluate(() => {
    const iframe = document.getElementById('app-frame') as HTMLIFrameElement;
    const header = document.querySelector('.host-header') as HTMLElement;
    const sponsorCta = document.querySelector('.sponsor-cta') as HTMLElement;
    const footer = document.querySelector('footer') as HTMLElement;
    const claimedByOthers =
      header.getBoundingClientRect().height +
      sponsorCta.getBoundingClientRect().height +
      footer.getBoundingClientRect().height;
    return {
      frameHeight: iframe.getBoundingClientRect().height,
      availableHeight: window.innerHeight - claimedByOthers,
    };
  });
  // Slack is for sub-pixel rounding, not the ~110px+ gap the bug produced.
  assert.ok(
    Math.abs(frameHeight - availableHeight) < 3,
    `iframe height (${frameHeight}px) should fill the space left over after ` +
      `the header/sponsor-cta/footer (${availableHeight}px), not collapse`,
  );

  const outerFooterVisible = await page.evaluate(() => {
    const footer = document.querySelector('footer');
    return footer !== null && footer.getBoundingClientRect().height > 0;
  });
  assert.equal(outerFooterVisible, true, 'the host page shows its own footer');

  const innerFooterVisible = await iframeFrame.evaluate(() => {
    const footer = document.querySelector('footer');
    if (!footer) return false;
    return footer.getBoundingClientRect().height > 0 && getComputedStyle(footer).display !== 'none';
  });
  assert.equal(
    innerFooterVisible,
    false,
    "the embedded app's own footer must stay hidden, or it doubles up with the host's",
  );
});
