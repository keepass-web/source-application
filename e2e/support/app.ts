/** Uploads the fixture to local.html and unlocks the app it embeds, returning
 * the app's frame. Shared by every e2e that needs an open database. */
import assert from 'node:assert/strict';
import type { ElementHandle, Frame, Page } from 'puppeteer-core';
import type { KdbxFixture } from './fixture.ts';

export async function openApp(page: Page, origin: string, fixture: KdbxFixture): Promise<Frame> {
  await page.goto(`${origin}/local.html`, { waitUntil: 'networkidle0' });
  const fileInput = (await page.waitForSelector('#file-input')) as ElementHandle<HTMLInputElement>;
  await fileInput.uploadFile(fixture.path);
  const frameElement = await page.waitForSelector('#app-frame');
  assert.ok(frameElement, 'the app is embedded in an iframe');
  const frame = (await frameElement.contentFrame()) as Frame;
  const passwordInput = await frame.waitForSelector('#master-password');
  assert.ok(passwordInput, 'the embedded app shows its unlock screen');
  await passwordInput.type(fixture.password);
  await frame.click('#unlock-btn');
  await frame.waitForSelector('#group-tree .group-btn');
  return frame;
}
