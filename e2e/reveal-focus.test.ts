/** The caret has to survive a click on a control that acts on the field it
 * sits beside (issue #72). jsdom never moves focus on a press at all, so the
 * pages suite can only assert that the press is cancelled; a real browser is
 * the only place the focus move it prevents actually happens. The unlock
 * screen's reveal toggle stands in for the entry-edit row's controls too —
 * all of them go through the same helper. A reveal also brings the caret to
 * its field from wherever it was, since typing is what comes next (issue
 * #110); only a real browser shows it landing where typing left off. */
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
  // The second test navigates away from the file the first one chose, and a
  // chosen file makes Chrome ask first (#66). That prompt is the subject of
  // navigation-guard.test.ts; here it is in the way.
  page.on('dialog', (dialog) => void dialog.accept());
});

after(async () => {
  await browser.close();
  await server.close();
});

// Stop at the unlock screen: this is about typing a password, not reading a database.
async function openUnlockScreen(): Promise<{ app: Frame; passwordInput: ElementHandle }> {
  const fixture = await writeKdbxFixture();

  await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  assert.ok(fileInput, 'the chooser offers a file input');
  await fileInput.uploadFile(fixture.path);

  const frameElement = await page.waitForSelector('#app-frame');
  assert.ok(frameElement, 'the app is embedded in an iframe');
  const app = (await frameElement.contentFrame()) as Frame;

  const passwordInput = await app.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app shows its unlock screen');
  return { app, passwordInput };
}

function readPasswordField(app: Frame) {
  return app.evaluate(() => ({
    focused: document.activeElement?.id ?? '',
    type: (document.getElementById('master-password') as HTMLInputElement).type,
    value: (document.getElementById('master-password') as HTMLInputElement).value,
  }));
}

test('revealing the master password leaves the caret in the field', async () => {
  const { app, passwordInput } = await openUnlockScreen();
  await passwordInput.type('half-typed');

  await app.click('[data-action="toggle-password"]');

  const state = await readPasswordField(app);
  assert.equal(state.focused, 'master-password', 'the field kept focus, so typing carries on');
  assert.equal(state.type, 'text', 'and the toggle still revealed the password');
  assert.equal(state.value, 'half-typed', 'without disturbing what was already typed');
});

test('revealing the master password brings the caret back from elsewhere', async () => {
  const { app, passwordInput } = await openUnlockScreen();
  await passwordInput.type('half-typed');

  await app.click('#db-filename'); // a click on plain text, away from any field
  assert.equal((await readPasswordField(app)).focused, '', 'the field lost focus');

  await app.click('[data-action="toggle-password"]');
  await page.keyboard.type('-and-done');

  const state = await readPasswordField(app);
  assert.equal(state.focused, 'master-password', 'the reveal put the caret in the field');
  assert.equal(state.type, 'text', 'and still revealed the password');
  assert.equal(state.value, 'half-typed-and-done', 'so typing picks up where it left off');
});
