/**
 * Unit tests for cloud-google-drive/logic.ts — the connector's pure Drive-URL
 * and DOM-lookup helpers. All DOM-free, so exercised directly here (contrast
 * cloud-google-drive-page.test.ts, which drives page.ts through jsdom).
 * Sign-in and file browsing live in Google's SDKs, so there is no OAuth logic
 * to test here. Format detection (packages/router) and the embedded-app
 * message protocol (packages/embed-protocol) have their own test suites.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDriveDownloadUrl, buildDriveUpdateUrl, must } from '../cloud-google-drive/logic.ts';

test('must returns a present value and throws on null/undefined', () => {
  assert.equal(must('x'), 'x');
  assert.equal(must(0), 0);
  assert.throws(() => must(null), /expected element not found/);
  assert.throws(() => must(undefined), /expected element not found/);
});

test('buildDriveDownloadUrl / buildDriveUpdateUrl encode the id', () => {
  assert.equal(
    buildDriveDownloadUrl('https://drive.example/v3', 'a/b c'),
    'https://drive.example/v3/files/a%2Fb%20c?alt=media',
  );
  assert.equal(
    buildDriveUpdateUrl('https://up.example/v3', 'id9'),
    'https://up.example/v3/files/id9?uploadType=media',
  );
});
