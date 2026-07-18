/**
 * Regression coverage for two real-browser-only bugs jsdom's suite structurally
 * cannot see (jsdom has no layout engine): the embedded 0x67 iframe collapsing
 * to Chrome's small intrinsic default height instead of filling its container,
 * and the iframe's own footer doubling up with the host page's. Both were
 * found by hand against a real browser this session; this makes that manual
 * check permanent and automatic.
 *
 * Reaches the embedded-app screen the same way the manual check did — cloning
 * tpl-host into #root and pointing the iframe straight at 0x67.html — rather
 * than through the real Google sign-in/picker flow, which needs live OAuth
 * credentials this suite deliberately doesn't have. Stubbing that flow (via a
 * page.evaluateOnNewDocument init script, mirroring how the jsdom suite hoists
 * fake globals before importing page.ts) is future work, not needed here.
 */
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
    // Harmless on a normal machine; some CI containers need it even for a
    // non-root user, depending on the runner's sandbox/cgroup setup.
    args: ['--no-sandbox'],
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
  // Wait for the embedded document to actually render its own screen, not
  // just start loading — its mark/wordmark is present on every screen.
  await iframeFrame.waitForSelector('.wordmark');

  // --- Height: the iframe should fill essentially all vertical space left
  // over once every sibling that claims its own fixed space is accounted
  // for — the host-header above it (inside #root), and the outer page's own
  // sponsor-cta/footer below it (outside #root, per page.css's flex-shrink:0
  // siblings). Not collapse to a browser's small intrinsic default — see
  // cloud-google-drive/page.css's `body { height: 100vh }` fix.
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
  // A couple of pixels of slack for sub-pixel layout rounding — not for the
  // ~110px+ gap the collapsed-iframe bug actually produced.
  assert.ok(
    Math.abs(frameHeight - availableHeight) < 3,
    `iframe height (${frameHeight}px) should fill the space left over after ` +
      `the header/sponsor-cta/footer (${availableHeight}px), not collapse`,
  );

  // --- Footer: the outer host page keeps its own footer visible; the
  // embedded document's own copy must be hidden (body.embedded in
  // 0x67/page.ts + page.css), not doubled up alongside it.
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
