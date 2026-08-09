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
import {
  buildDriveCreateUrl,
  buildDriveDownloadUrl,
  buildDriveUpdateUrl,
  buildMultipartBody,
  must,
} from '../cloud-google-drive/logic.ts';

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

test('buildDriveCreateUrl builds the multipart-upload URL', () => {
  assert.equal(
    buildDriveCreateUrl('https://up.example/v3'),
    'https://up.example/v3/files?uploadType=multipart',
  );
});

test('buildMultipartBody wraps the filename and bytes in a multipart/related body', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]).buffer;
  const { body, boundary } = buildMultipartBody('vault.kdbx', bytes);
  const decoded = new TextDecoder().decode(await body.arrayBuffer());

  assert.ok(decoded.startsWith(`--${boundary}\r\n`));
  assert.match(
    decoded,
    /Content-Type: application\/json; charset=UTF-8\r\n\r\n\{"name":"vault\.kdbx"\}\r\n/,
  );
  assert.ok(decoded.includes('Content-Type: application/octet-stream\r\n\r\n\x01\x02\x03\x04'));
  assert.ok(decoded.trimEnd().endsWith(`--${boundary}--`));
});

test('buildMultipartBody generates a fresh boundary each call', () => {
  const bytes = new ArrayBuffer(0);
  const a = buildMultipartBody('a.kdbx', bytes);
  const b = buildMultipartBody('a.kdbx', bytes);
  assert.notEqual(a.boundary, b.boundary);
});
