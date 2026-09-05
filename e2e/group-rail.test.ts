/** Real-browser coverage for the group rail (issue #63). Both assertions here
 * need a layout engine, which jsdom does not have: that the rail's default
 * width really does show 25 characters of a sub-group name with no
 * intervention, and that dragging the handle really does resize it. */
import assert from 'node:assert/strict';
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
let page: Page;
let app: Frame;
let fixture: KdbxFixture;

before(async () => {
  server = await startDistServer(distDir);
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    ...resolveLaunchOptions(),
    args: ['--no-sandbox'],
  });
  page = await browser.newPage();
  // Comfortably wider than the 700px drawer breakpoint, so the rail is the
  // resizable side rail rather than the mobile drawer.
  await page.setViewport({ width: 1280, height: 900 });
  fixture = await writeKdbxFixture();

  app = await openApp(page);
});

/** Upload the fixture to local.html and unlock the app it embeds, returning
 * the app's frame. */
async function openApp(target: Page): Promise<Frame> {
  await target.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
  const fileInput = (await target.waitForSelector(
    '#file-input',
  )) as ElementHandle<HTMLInputElement>;
  await fileInput.uploadFile(fixture.path);
  const frameElement = await target.waitForSelector('#app-frame');
  assert.ok(frameElement, 'the app is embedded in an iframe');
  const frame = (await frameElement.contentFrame()) as Frame;
  const passwordInput = await frame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app shows its unlock screen');
  await passwordInput.type(fixture.password);
  await frame.click('#unlock-btn');
  await frame.waitForSelector('#group-tree .group-btn');
  return frame;
}

after(async () => {
  await browser.close();
  await server.close();
});

test('the rail shows 25 characters of a sub-group name without any intervention', async (t) => {
  const measured = await app.$$eval(
    '#group-tree .group-btn',
    (buttons, name) => {
      const button = buttons.find((b) => b.textContent?.endsWith(name));
      if (!button) return null;
      // scrollWidth is clamped to clientWidth, so it can only ever report
      // "overflowing" or "not" — never by how much. Measuring the text itself
      // against the content box gives a margin that can be watched over time.
      const text = document.createRange();
      text.selectNodeContents(button);
      const style = getComputedStyle(button);
      const padding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      return {
        needed: text.getBoundingClientRect().width,
        available: button.clientWidth - padding,
      };
    },
    fixture.groupName,
  );

  assert.ok(measured, `the rail lists "${fixture.groupName}"`);
  // Reported on every run: the monospace fallback differs between developer
  // machines and CI, so a shrinking margin here is the early warning that the
  // default width is drifting towards truncation.
  t.diagnostic(
    `25-character group name needs ${measured.needed.toFixed(1)}px of the ${measured.available.toFixed(1)}px content box (${(measured.available - measured.needed).toFixed(1)}px spare)`,
  );
  assert.ok(
    measured.needed <= measured.available,
    `"${fixture.groupName}" does not fit the default rail: needs ${measured.needed.toFixed(1)}px, has ${measured.available.toFixed(1)}px`,
  );
});

test('dragging the handle resizes the rail', async () => {
  const railWidth = (): Promise<number> =>
    app.$eval('#sidebar', (el) => el.getBoundingClientRect().width);

  const handle = await app.$('#sidebar-resize');
  assert.ok(handle, 'the rail has a resize handle');
  const box = await handle.boundingBox();
  assert.ok(box, 'the handle is laid out');

  const startWidth = await railWidth();
  const y = box.y + 20;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, y, { steps: 8 });
  await page.mouse.up();

  const endWidth = await railWidth();
  assert.ok(
    endWidth > startWidth,
    `dragging right widened the rail (${startWidth}px -> ${endWidth}px)`,
  );
});

test('at phone width the rail is a drawer: no resize handle, and ⋯ still reaches rename', async () => {
  const phone = await browser.newPage();
  await phone.setViewport({ width: 375, height: 812 });
  const phoneApp = await openApp(phone);

  assert.equal(
    await phoneApp.$eval('#sidebar-resize', (el) => getComputedStyle(el).display),
    'none',
    'the drawer has no edge to drag, so the handle is not rendered',
  );

  await phoneApp.click('[data-action="toggle-sidebar"]');
  await phoneApp.waitForSelector('#sidebar.sidebar-open');
  // The drawer slides in over 0.2s; clicking mid-flight misses the button.
  await phoneApp.waitForFunction(() => {
    const drawer = document.querySelector('#sidebar');
    return drawer !== null && getComputedStyle(drawer).transform === 'matrix(1, 0, 0, 1, 0, 0)';
  });

  // Every drawer row exposes its ⋯, because tapping a group to make it active
  // would close the drawer and cost a second visit.
  const menuButton = await phoneApp.evaluateHandle((name) => {
    const rows = Array.from(document.querySelectorAll('#group-tree .group-row'));
    const row = rows.find((r) => r.querySelector('.group-btn')?.textContent?.endsWith(name));
    return row?.querySelector('.group-menu-btn') ?? null;
  }, fixture.groupName);
  const menuElement = menuButton.asElement() as ElementHandle<HTMLElement> | null;
  assert.ok(menuElement, 'the sub-group row has a ⋯ button in the drawer');
  assert.notEqual(
    await menuElement.evaluate((el) => getComputedStyle(el).visibility),
    'hidden',
    '⋯ is visible without first selecting the row',
  );

  await menuElement.click();
  const labels = await phoneApp.$$eval('.group-menu-item', (items) =>
    items.map((i) => i.textContent),
  );
  assert.deepEqual(labels, ['Rename', 'Move'], 'the menu opens with rename and move');

  assert.ok(await phoneApp.$('#sidebar.sidebar-open'), 'opening the menu left the drawer open');
  await phone.close();
});

test('a rail widened on desktop does not follow the user into the phone drawer', async () => {
  const handle = await app.$('#sidebar-resize');
  assert.ok(handle, 'the rail has a resize handle');
  const box = await handle.boundingBox();
  assert.ok(box, 'the handle is laid out');

  const y = box.y + 20;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 400, y, { steps: 8 });
  await page.mouse.up();

  const railWidth = (): Promise<number> =>
    app.$eval('#sidebar', (el) => el.getBoundingClientRect().width);
  const wide = await railWidth();
  assert.ok(wide > 400, `the rail is dragged wide first (${wide}px)`);

  await page.setViewport({ width: 375, height: 812 });
  const drawer = await railWidth();
  assert.ok(
    drawer <= 375,
    `the drawer keeps its own width at phone size (${drawer}px inside a 375px viewport)`,
  );

  await page.setViewport({ width: 1280, height: 900 });
});
