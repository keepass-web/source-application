/**
 * Real <dialog> rendering: jsdom's HTMLDialogElement polyfill (see
 * pages/tests/0x67-page.test.ts's file header — jsdom doesn't implement
 * showModal()/close() at all) only tracks open/closed state via a plain
 * boolean. It can't verify the backdrop actually dims the page, that the
 * dialog card actually gets a shadow, or that it's actually centered on
 * screen, since jsdom has no layout engine and never runs real CSS. A real
 * browser can check all three directly.
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
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
});

after(async () => {
  await browser.close();
  await server.close();
});

test('a real dialog gets an actual dimmed backdrop and a centered, shadowed card', async () => {
  await page.goto(`${server.origin}/0x67.html`, { waitUntil: 'networkidle0' });

  // "Create a new database" is the shortest path to a screen with a dialog —
  // no fixture file or upload needed.
  await page.click('[data-action="create-database"]');
  await page.waitForSelector('#create-password');
  await page.type('#create-password', 'e2e-test-password');
  await page.type('#create-password-confirm', 'e2e-test-password');
  await Promise.all([page.waitForSelector('.entry-list'), page.click('#create-btn')]);

  await page.click('[data-action="settings"]');
  await page.waitForSelector('#dlg-settings[open]');

  const { backdropColor, boxShadow, isRoughlyCentered } = await page.evaluate(() => {
    const dialog = document.getElementById('dlg-settings') as HTMLDialogElement;
    const style = getComputedStyle(dialog);
    const rect = dialog.getBoundingClientRect();
    const viewportCenterX = window.innerWidth / 2;
    const dialogCenterX = rect.left + rect.width / 2;
    return {
      backdropColor: getComputedStyle(dialog, '::backdrop').backgroundColor,
      boxShadow: style.boxShadow,
      isRoughlyCentered: Math.abs(dialogCenterX - viewportCenterX) < 20,
    };
  });

  assert.notEqual(boxShadow, 'none', 'the dialog card has a real shadow, not just a flat border');
  assert.ok(
    backdropColor.startsWith('rgba') || backdropColor.startsWith('rgb'),
    `the ::backdrop pseudo-element actually dims the page (got "${backdropColor}")`,
  );
  assert.ok(isRoughlyCentered, 'the dialog is horizontally centered on screen');
});
