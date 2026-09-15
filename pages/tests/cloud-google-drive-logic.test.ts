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
  backoffDelayMs,
  buildDriveCreateUrl,
  buildDriveDownloadUrl,
  buildDriveUpdateUrl,
  buildMultipartBody,
  classifyDriveResponse,
  driveErrorReason,
  MAX_DRIVE_ATTEMPTS,
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

test('driveErrorReason digs the reason out of a Drive error body, or gives up quietly', () => {
  assert.equal(
    driveErrorReason({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }),
    'userRateLimitExceeded',
  );
  assert.equal(driveErrorReason(null), undefined);
  assert.equal(driveErrorReason({}), undefined);
  assert.equal(driveErrorReason({ error: {} }), undefined);
  assert.equal(driveErrorReason({ error: { errors: [] } }), undefined);
  assert.equal(driveErrorReason({ error: { errors: [{}] } }), undefined);
  assert.equal(driveErrorReason({ error: { errors: [{ reason: 7 }] } }), undefined);
});

test('classifyDriveResponse separates success, expiry, transient failure, and the rest', () => {
  assert.equal(classifyDriveResponse(200), 'ok');
  assert.equal(classifyDriveResponse(204), 'ok');
  assert.equal(classifyDriveResponse(401), 'auth-expired');
  assert.equal(classifyDriveResponse(429), 'retry');
  assert.equal(classifyDriveResponse(500), 'retry');
  assert.equal(classifyDriveResponse(503), 'retry');
  assert.equal(classifyDriveResponse(404), 'fail');
  assert.equal(classifyDriveResponse(400), 'fail');
});

test('a 403 is retried only when its body names a rate limit', () => {
  assert.equal(classifyDriveResponse(403), 'fail');
  assert.equal(classifyDriveResponse(403, 'insufficientPermissions'), 'fail');
  assert.equal(classifyDriveResponse(403, 'rateLimitExceeded'), 'retry');
  assert.equal(classifyDriveResponse(403, 'userRateLimitExceeded'), 'retry');
});

test('backoffDelayMs grows the window exponentially and jitters within it', () => {
  assert.equal(
    backoffDelayMs(0, () => 1),
    500,
  );
  assert.equal(
    backoffDelayMs(1, () => 1),
    1000,
  );
  assert.equal(
    backoffDelayMs(2, () => 1),
    2000,
  );
  assert.equal(
    backoffDelayMs(0, () => 0),
    0,
    'full jitter can pick the bottom of the window',
  );
  assert.equal(
    backoffDelayMs(0, () => 0.5),
    250,
  );
  assert.equal(
    backoffDelayMs(99, () => 1),
    8000,
    'the window stops growing at the ceiling',
  );

  const sampled = backoffDelayMs(1);
  assert.ok(sampled >= 0 && sampled <= 1000, 'the default source of jitter stays in the window');
});

test('MAX_DRIVE_ATTEMPTS leaves room to retry without hammering Drive', () => {
  assert.ok(MAX_DRIVE_ATTEMPTS > 1 && MAX_DRIVE_ATTEMPTS <= 5);
});
