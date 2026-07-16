/**
 * Unit tests for cloud-google-drive/logic.ts — the connector's pure Drive-URL
 * and message-guard helpers. All DOM-free, so exercised directly here (contrast
 * cloud-google-drive-page.test.ts, which drives page.ts through jsdom).
 * Sign-in and file browsing live in Google's SDKs, so there is no OAuth logic
 * to test here.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildDriveDownloadUrl,
  buildDriveUpdateUrl,
  isCloseAckMessage,
  isReadyMessage,
  isSaveMessage,
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

test('isReadyMessage recognises the handshake', () => {
  assert.equal(isReadyMessage({ type: 'kw-ready' }), true);
  assert.equal(isReadyMessage(null), false);
  assert.equal(isReadyMessage(42), false);
  assert.equal(isReadyMessage({ type: 'nope' }), false);
});

test('isSaveMessage requires a filename string and ArrayBuffer bytes', () => {
  assert.equal(
    isSaveMessage({ type: 'kw-save', filename: 'a.kdbx', bytes: new ArrayBuffer(2) }),
    true,
  );
  assert.equal(isSaveMessage(null), false);
  assert.equal(isSaveMessage('x'), false);
  assert.equal(isSaveMessage({ type: 'kw-save', filename: 1, bytes: new ArrayBuffer(2) }), false);
  assert.equal(isSaveMessage({ type: 'kw-save', filename: 'a', bytes: 'no' }), false);
});

test('isCloseAckMessage recognises the close acknowledgement', () => {
  assert.equal(isCloseAckMessage({ type: 'kw-close-ack' }), true);
  assert.equal(isCloseAckMessage(null), false);
  assert.equal(isCloseAckMessage(42), false);
  assert.equal(isCloseAckMessage({ type: 'nope' }), false);
});
