/** What a keyboard, a screen reader and a reader's own display settings get from the
 * built pages (#210). jsdom has no focus order, no accessibility tree, no layout and no
 * media emulation, so only a real browser can show any of it. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import puppeteer, {
  type Browser,
  type CDPSession,
  type ElementHandle,
  type Frame,
} from 'puppeteer-core';
import { openApp } from './support/app.ts';
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
  fixture = await writeKdbxFixture();
});

after(async () => {
  await browser.close();
  await server.close();
});

test('Tab reaches the database picker, its label shows the focus, and Enter opens it', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'file-input');
    assert.equal(
      await page.$eval('label.btn', (label) => getComputedStyle(label).outlineStyle),
      'auto',
      'the input is not drawn, so its label carries the ring',
    );
    /* Enter opens the chooser through the click it dispatches on the input. That click is
     * what's checked, cancelled so no dialog opens: waiting on the chooser itself missed it
     * under the load of the whole suite running at once. */
    await page.$eval('input#file-input', (input) =>
      input.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          input.dataset.activated = 'yes';
        },
        { once: true },
      ),
    );
    await page.keyboard.press('Enter');
    await page.waitForSelector('#file-input[data-activated="yes"]');
  } finally {
    await page.close();
  }
});

test('Tab reaches the key file picker, which is labeled by its field', async () => {
  const page = await browser.newPage();
  try {
    await page.goto(`${server.origin}/local.html`, { waitUntil: 'networkidle0' });
    const picker = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
    await picker.uploadFile(fixture.path);
    const app = (await (await page.waitForSelector('#app-frame'))?.contentFrame()) as Frame;
    await app.waitForSelector('#master-password');
    await app.focus('#master-password');

    // Past the reveal button beside the password.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    assert.equal(await app.evaluate(() => document.activeElement?.id), 'keyfile-input');
    assert.deepEqual(
      await app.$eval('#keyfile-input', (input) =>
        Array.from((input as HTMLInputElement).labels ?? [], (label) => label.textContent?.trim()),
      ),
      ['Key file (optional)', 'No file chosen'],
    );
  } finally {
    await page.close();
  }
});

test('every box on the edit screen is named for what it holds', async () => {
  const page = await browser.newPage();
  try {
    const app = await openApp(page, server.origin, fixture);
    await app.click('[data-action="add-entry"]');
    await app.waitForSelector('#edit-fields .edit-field');
    for (const field of ['Title', 'UserName', 'Password', 'URL', 'Notes']) {
      assert.ok(await app.$(`aria/${field}[role="textbox"]`), `a box named ${field}`);
    }
    // A field with no name yet keeps "Value", rather than borrowing its name box's placeholder.
    await app.click('[data-action="add-field"]');
    assert.ok(await app.$('aria/Value[role="textbox"]'), "an unnamed field's box is called Value");

    const attach = (await app.$('#edit-attachment-input')) as ElementHandle<HTMLInputElement>;
    await attach.uploadFile(fixture.path);
    await app.waitForSelector('.attachment-name');
    assert.ok(
      await app.$('aria/Attachment name[role="textbox"]'),
      'a box named for the attachment',
    );
  } finally {
    await page.close();
  }
});

test('an icon-only button is named once, by its title', async () => {
  const page = await browser.newPage();
  try {
    const app = await openApp(page, server.origin, fixture);
    /* An aria-label that repeats a title makes the title a description, which a screen reader
     * can read out as the name again. Only the frame's own CDP session, which puppeteer keeps
     * internal, can resolve the frame's handles. */
    const client = (app as unknown as { client: CDPSession }).client;
    const check = async (screen: string): Promise<void> => {
      let checked = 0;
      for (const button of await app.$$('button[title]')) {
        // A group's actions button stays visibility: hidden until its row is hovered.
        const { title, iconOnly } = await button.evaluate((el) => ({
          title: el.title,
          iconOnly: el.checkVisibility({ visibilityProperty: true }) && !el.textContent?.trim(),
        }));
        if (!iconOnly) continue;
        const { objectId } = button.remoteObject();
        assert.ok(objectId, `${screen}: ${title} has a handle`);
        const { node } = await client.send('DOM.describeNode', { objectId });
        const { nodes } = await client.send('Accessibility.getPartialAXTree', {
          backendNodeId: node.backendNodeId,
          fetchRelatives: false,
        });
        const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
        assert.equal(ax?.name?.value, title, `${screen}: ${title}`);
        assert.equal(ax?.description?.value ?? '', '', `${screen}: ${title} has no description`);
        checked++;
      }
      assert.ok(checked > 0, `${screen} has icon-only buttons to check`);
    };
    await check('the entry list');
    await app.click('.entry-table-open button');
    await app.waitForSelector('[data-action="edit"]', { visible: true });
    await check('an entry');
    await app.click('[data-action="edit"]');
    await app.waitForSelector('#edit-fields .edit-field');
    await check('the edit screen');
  } finally {
    await page.close();
  }
});

test("text follows the browser's default font size on every page", async () => {
  const page = await browser.newPage();
  try {
    for (const [file, share] of [
      ['index.html', 1],
      ['local.html', 0.9375],
      ['0x67.html', 0.9375],
      ['cloud-google-drive.html', 0.9375],
      ['privacy.html', 1],
      ['terms.html', 1],
    ] as const) {
      await page.goto(`${server.origin}/${file}`, { waitUntil: 'load' });
      const size = await page.evaluate(() => {
        document.documentElement.style.fontSize = '20px';
        return getComputedStyle(document.body).fontSize;
      });
      assert.equal(size, `${20 * share}px`, file);
    }
  } finally {
    await page.close();
  }
});

test('the phone drawer slides only when the system allows motion', async () => {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 375, height: 812 });
    const app = await openApp(page, server.origin, fixture);
    const duration = () => app.$eval('#sidebar', (el) => getComputedStyle(el).transitionDuration);
    assert.equal(await duration(), '0.2s');
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await duration(), '0s');
  } finally {
    await page.close();
  }
});

test('forced colors keep focus, the current group and the current view visible', async () => {
  const page = await browser.newPage();
  try {
    // Puppeteer's own emulation doesn't offer forced-colors, so ask Chrome directly, and
    // before the app loads: switched on later, it doesn't restyle what the iframe already drew.
    const session = await page.createCDPSession();
    await session.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    const app = await openApp(page, server.origin, fixture);
    await app.focus('#search-input');
    const look = await app.evaluate(() => {
      const style = (selector: string) =>
        getComputedStyle(document.querySelector(selector) as Element);
      const probe = document.createElement('div');
      probe.style.background = 'Highlight';
      document.body.append(probe);
      const highlight = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        forced: matchMedia('(forced-colors: active)').matches,
        highlight,
        focusOutline: style('#search-input').outlineStyle,
        group: style('.group-btn.active').backgroundColor,
        view: style('.view-toggle-btn.active').backgroundColor,
      };
    });
    assert.ok(look.forced, 'the app sees forced colors');
    assert.equal(look.focusOutline, 'solid', 'a focused field draws an outline of its own');
    assert.equal(look.group, look.highlight, 'the current group is highlighted');
    assert.equal(look.view, look.highlight, 'and so is the current view');
  } finally {
    await page.close();
  }
});
