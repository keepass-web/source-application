/** Real-browser coverage for where the unlock and open screens sit (#214).
 * jsdom has no layout engine, so only a real browser can show that the forms
 * start at a fixed distance from the top whatever the viewport's height (so a
 * phone keyboard, which covers the bottom of the screen, leaves Unlock in
 * view), and that a wrong-password error neither widens the form nor moves
 * what sits above it. */
import assert from 'node:assert/strict';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, { type Browser, type ElementHandle, type Frame, type Page } from 'puppeteer-core';
import { resolveChromePath } from './support/chrome.ts';
import { type DistServer, startDistServer } from './support/dist-server.ts';
import { type KdbxFixture, writeKdbxFixture } from './support/fixture.ts';
import { resolveLaunchOptions } from './support/launch-options.ts';

const distDir = fileURLToPath(new URL('../dist', import.meta.url));

let server: DistServer;
let browser: Browser;
let fixture: KdbxFixture;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  // A short file name, so the heading is narrower than the form's width cap
  // and a form that shrinks to its content would show it.
  const written = await writeKdbxFixture();
  const shortPath = join(await mkdtemp(join(tmpdir(), 'keepass-web-e2e-')), 'Vault.kdbx');
  await copyFile(written.path, shortPath);
  fixture = { ...written, path: shortPath };
});

after(async () => {
  await browser.close();
  await server.close();
});

/** Opens the fixture through local.html and returns the embedded app at its unlock screen. */
async function unlockScreenAt(width: number, height: number): Promise<{ page: Page; app: Frame }> {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  await fileInput.uploadFile(fixture.path);
  const app = (await (await page.waitForSelector('#app-frame'))?.contentFrame()) as Frame;
  await app.waitForSelector('#master-password');
  return { page, app };
}

function box(frame: Frame | Page, selector: string) {
  return frame.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, width: r.width };
  });
}

test('the unlock form starts at the same height on a short or a tall screen', async () => {
  const short = await unlockScreenAt(390, 844);
  const tall = await unlockScreenAt(390, 1400);
  try {
    const shortForm = await box(short.app, '.screen-unlock');
    const tallForm = await box(tall.app, '.screen-unlock');
    assert.equal(tallForm.top, shortForm.top, 'anchored to the top, not centered');
    const unlock = await box(short.app, '#unlock-btn');
    const frame = await box(short.page, '#app-frame');
    assert.ok(
      frame.top + unlock.bottom < 844 / 2,
      'Unlock sits in the top half of a phone, clear of its keyboard',
    );
  } finally {
    await short.page.close();
    await tall.page.close();
  }
});

test('a wrong password neither widens the form nor moves what is above the error', async () => {
  const { page, app } = await unlockScreenAt(1280, 800);
  try {
    const formBefore = await box(app, '.screen-unlock');
    const passwordBefore = await box(app, '#master-password');
    assert.equal(Math.round(formBefore.width), 400, 'up to its 400px cap, not just its content');

    await app.type('#master-password', 'not the password');
    await app.click('#unlock-btn');
    await app.waitForSelector('#unlock-error:not([hidden])');

    const formAfter = await box(app, '.screen-unlock');
    const passwordAfter = await box(app, '#master-password');
    assert.equal(formAfter.width, formBefore.width);
    assert.equal(formAfter.top, formBefore.top);
    assert.equal(passwordAfter.top, passwordBefore.top);
  } finally {
    await page.close();
  }
});

test('the open screen starts at the same height and the footer stays at the bottom', async () => {
  const measure = async (height: number) => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height });
    await page.goto(`${server.origin}/0x67.html`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.screen-upload');
    const screen = await box(page, '.screen-upload');
    const footer = await box(page, 'footer');
    await page.close();
    return { screen, footer };
  };
  const short = await measure(800);
  const tall = await measure(1100);
  assert.equal(tall.screen.top, short.screen.top, 'anchored to the top, not centered');
  assert.equal(tall.footer.bottom - short.footer.bottom, 300, 'the footer follows the bottom edge');
});
