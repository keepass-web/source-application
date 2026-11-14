/** Idle curtain and auto-lock (#84), in a real browser. jsdom can neither
 * paint a modal over the page nor throttle a background tab, so this shows
 * the curtain really covers the embedded app, that a click lifts it, and that
 * the lock still lands while another tab is in front. */
import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Page } from 'puppeteer-core';
import { openApp } from './support/app.ts';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));
// The settings dialog's floors, so the waits below are as short as the app allows.
const CURTAIN_SECONDS = 15;
const LOCK_SECONDS = 30;

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
  await page.setViewport({ width: 1280, height: 900 });
});

after(async () => {
  await browser.close();
  await server.close();
});

test('idle brings a curtain down over the app, then locks it', async () => {
  const fixture = await writeKdbxFixture();
  const app = await openApp(page, server.origin, fixture);

  await app.click('[data-action="settings"]');
  for (const [id, seconds] of [
    ['#curtain-timeout', CURTAIN_SECONDS],
    ['#auto-lock-timeout', LOCK_SECONDS],
  ] as const) {
    const input = (await app.waitForSelector(id)) as ElementHandle<HTMLInputElement>;
    await input.evaluate((el, value: number) => {
      el.value = String(value);
    }, seconds);
  }
  await app.click('#dlg-settings [data-action="save-settings"]');

  await app.waitForFunction(
    () => document.querySelector<HTMLDialogElement>('#dlg-curtain')?.open === true,
    { timeout: (CURTAIN_SECONDS + 10) * 1000 },
  );
  const cover = await app.$eval('#dlg-curtain', (el) => {
    const r = el.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      onTop:
        document
          .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          ?.closest('#dlg-curtain') != null,
    };
  });
  assert.equal(cover.width, cover.viewportWidth, 'the curtain spans the app');
  assert.equal(cover.height, cover.viewportHeight);
  assert.ok(cover.onTop, 'and nothing of the app shows through it');

  await app.click('#dlg-curtain button');
  assert.equal(
    await app.$eval('#dlg-curtain', (el) => (el as HTMLDialogElement).open),
    false,
    'a click lifts it',
  );

  // Somewhere else is now in front, and the lock still lands in time.
  const otherTab = await browser.newPage();
  await otherTab.bringToFront();
  await app.waitForSelector('#master-password', {
    timeout: (LOCK_SECONDS + 20) * 1000,
  });

  await page.bringToFront();
  await otherTab.close();
  assert.equal(
    await page.title(),
    `${basename(fixture.path)} - Locked - KeePass Web - Local file`,
    'and the tab bar shows it locked, without being opened',
  );
  assert.equal(
    await app.$eval('#dlg-curtain', (el) => (el as HTMLDialogElement).open),
    false,
    'with no curtain left over the unlock screen',
  );
});

// The built page carries the form through the lock inside the encrypted database, attachment
// bytes and all, using the bundle's own copies of the kdbx helpers (#185).
test('an edit screen the lock closed over comes back on unlocking, as it was left', async () => {
  const fixture = await writeKdbxFixture();
  const tab = await browser.newPage(); // a fresh tab, so no prompt guards leaving the last one
  try {
    await tab.setViewport({ width: 1280, height: 900 });
    const app = await openApp(tab, server.origin, fixture);
    await app.click('[data-action="add-entry"]');
    const title = (await app.waitForSelector(
      '#edit-fields .edit-value',
    )) as ElementHandle<HTMLInputElement>;
    await title.type('Bank');
    const attach = (await app.$('#edit-attachment-input')) as ElementHandle<HTMLInputElement>;
    await attach.uploadFile(fixture.path);
    await app.waitForSelector('#edit-attachments .attachment-name');

    // A day idle, noticed as soon as the tab is looked at, rather than waited out.
    await app.evaluate(() => {
      const realNow = Date.now;
      Date.now = () => realNow() + 24 * 3_600_000;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const password = (await app.waitForSelector('#master-password')) as ElementHandle;
    await password.type(fixture.password);
    await app.click('#unlock-btn');
    await app.waitForSelector('#root .screen-edit');
    assert.deepEqual(
      await app.evaluate(() => ({
        heading: document.querySelector('#edit-title')?.textContent,
        title: document.querySelector<HTMLInputElement>('#edit-fields .edit-value')?.value,
        attachments: Array.from(
          document.querySelectorAll<HTMLInputElement>('#edit-attachments .attachment-name'),
          (input) => input.value,
        ),
      })),
      { heading: 'New Entry', title: 'Bank', attachments: [basename(fixture.path)] },
    );
  } finally {
    await tab.close();
  }
});
