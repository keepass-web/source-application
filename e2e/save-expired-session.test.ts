/** Escape closes a real <dialog> natively, and jsdom's polyfill only tracks
 * open/closed state, so only a real browser can show that the expired-session
 * dialog actually refuses to be dismissed (#85). Reaches the embedded-app
 * screen by cloning tpl-host directly rather than the real OAuth flow, which
 * needs live credentials this suite doesn't have; this file then plays the
 * host itself, so it can answer a save with an expired session. */
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

declare global {
  interface Window {
    kwInbox: { type: string }[];
    kwReply: (message: unknown) => void;
  }
}

test('an expired session holds the save dialog open against Escape, offering a way out', async () => {
  await page.goto(`${server.origin}/cloud-google-drive.html`, { waitUntil: 'networkidle0' });

  // Stand in for the connector's own handleFrameMessage, so this test decides
  // what every save is answered with.
  await page.evaluate(() => {
    window.kwInbox = [];
    window.addEventListener('message', (event) => {
      window.kwInbox.push(event.data as { type: string });
    });
    window.kwReply = (message) => {
      const frame = document.getElementById('app-frame') as HTMLIFrameElement;
      (frame.contentWindow as Window).postMessage(message, window.location.origin);
    };
    const root = document.getElementById('root') as HTMLElement;
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-host') as HTMLTemplateElement;
    root.appendChild(tpl.content.cloneNode(true));
    (document.getElementById('app-frame') as HTMLIFrameElement).src = '0x67.html';
  });

  const iframeElement = await page.waitForSelector('#app-frame');
  assert.ok(iframeElement, 'the embedded app iframe renders');
  const app = await iframeElement.contentFrame();
  assert.ok(app, 'the iframe has a content frame');

  await page.waitForFunction(() => window.kwInbox.some((m) => m?.type === 'kw-ready'));
  await page.evaluate(() => {
    window.kwReply({ type: 'kw-create' });
  });

  await app.waitForSelector('#create-password');
  await app.type('#create-password', 'e2e-test-password');
  await app.type('#create-password-confirm', 'e2e-test-password');
  await Promise.all([app.waitForSelector('.entry-list'), app.click('#create-btn')]);

  await app.click('[data-action="save-database"]');
  await app.waitForSelector('#dlg-save[open]');
  await app.click('[data-action="save-host"]');

  await page.waitForFunction(() => window.kwInbox.some((m) => m?.type === 'kw-save'));
  await page.evaluate(() => {
    window.kwReply({ type: 'kw-saved', ok: false, error: 'HTTP 401', reason: 'auth-expired' });
  });

  await app.waitForFunction(() =>
    /Your Google session expired/.test(
      document.querySelector('[data-role="save-status"]')?.textContent ?? '',
    ),
  );

  // Focus has to be inside the frame for Escape to reach the dialog at all.
  await app.focus('[data-action="reconnect"]');
  await page.keyboard.press('Escape');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const state = await app.evaluate(() => {
    const dialog = document.getElementById('dlg-save') as HTMLDialogElement;
    const visible = (selector: string): boolean => {
      const el = dialog.querySelector<HTMLElement>(selector);
      return el !== null && !el.hidden;
    };
    return {
      open: dialog.open,
      reconnect: visible('[data-action="reconnect"]'),
      download: visible('[data-action="download"]'),
      dismissable: Array.from(dialog.querySelectorAll<HTMLElement>('[data-action="close"]')).some(
        (el) => !el.hidden,
      ),
    };
  });

  assert.equal(state.open, true, 'Escape must not strand the edits by closing the dialog');
  assert.equal(state.reconnect, true, 'Reconnect is on offer');
  assert.equal(state.download, true, 'so is taking a copy out');
  assert.equal(state.dismissable, false, 'and nothing dismisses it');

  // The footer carries a second action in this state, and there is no separate
  // mobile build to catch it overflowing.
  await page.setViewport({ width: 375, height: 700 });
  const fit = await app.evaluate(() => {
    const dialog = document.getElementById('dlg-save') as HTMLDialogElement;
    const footer = dialog.querySelector('.dialog-footer') as HTMLElement;
    return {
      footerOverflows: footer.scrollWidth > footer.clientWidth + 1,
      dialogOverflows: dialog.getBoundingClientRect().width > window.innerWidth,
    };
  });
  assert.equal(fit.footerOverflows, false, 'the expired footer fits at phone width');
  assert.equal(fit.dialogOverflows, false, 'the dialog fits at phone width');
});
