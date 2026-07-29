import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  closeAckMessage,
  closeMessage,
  closeRequestMessage,
  isCloseAckMessage,
  isCloseMessage,
  isCloseRequestMessage,
  isOpenMessage,
  isReadyMessage,
  isSavedMessage,
  isSaveMessage,
  openMessage,
  readyMessage,
  savedMessage,
  saveMessage,
} from '../src/index.ts';

test('readyMessage / isReadyMessage round-trip', () => {
  assert.deepEqual(readyMessage(), { type: 'kw-ready' });
  assert.equal(isReadyMessage(readyMessage()), true);
  assert.equal(isReadyMessage(null), false);
  assert.equal(isReadyMessage(42), false);
  assert.equal(isReadyMessage({ type: 'nope' }), false);
});

test('openMessage / isOpenMessage round-trip and reject malformed payloads', () => {
  const bytes = new ArrayBuffer(4);
  const msg = openMessage('vault.kdbx', bytes);
  assert.deepEqual(msg, { type: 'kw-open', filename: 'vault.kdbx', bytes });
  assert.equal(isOpenMessage(msg), true);
  assert.equal(isOpenMessage(null), false);
  assert.equal(isOpenMessage('x'), false);
  assert.equal(isOpenMessage({ type: 'kw-open', filename: 1, bytes }), false);
  assert.equal(isOpenMessage({ type: 'kw-open', filename: 'a', bytes: 'no' }), false);
});

test('saveMessage / isSaveMessage round-trip and reject malformed payloads', () => {
  const bytes = new ArrayBuffer(4);
  const msg = saveMessage('vault.kdbx', bytes);
  assert.deepEqual(msg, { type: 'kw-save', filename: 'vault.kdbx', bytes });
  assert.equal(isSaveMessage(msg), true);
  assert.equal(isSaveMessage(null), false);
  assert.equal(isSaveMessage({ type: 'kw-save', filename: 1, bytes }), false);
  assert.equal(isSaveMessage({ type: 'kw-save', filename: 'a', bytes: 'no' }), false);
});

test('savedMessage / isSavedMessage round-trip, with and without an error', () => {
  const ok = savedMessage(true);
  assert.deepEqual(ok, { type: 'kw-saved', ok: true });
  assert.equal(isSavedMessage(ok), true);

  const failed = savedMessage(false, 'HTTP 403');
  assert.deepEqual(failed, { type: 'kw-saved', ok: false, error: 'HTTP 403' });
  assert.equal(isSavedMessage(failed), true);

  assert.equal(isSavedMessage(null), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', ok: 'nope' }), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', ok: true, error: 42 }), false);
});

test('closeRequestMessage / isCloseRequestMessage round-trip', () => {
  assert.deepEqual(closeRequestMessage(), { type: 'kw-close-request' });
  assert.equal(isCloseRequestMessage(closeRequestMessage()), true);
  assert.equal(isCloseRequestMessage(null), false);
  assert.equal(isCloseRequestMessage({ type: 'nope' }), false);
});

test('closeAckMessage / isCloseAckMessage round-trip', () => {
  assert.deepEqual(closeAckMessage(), { type: 'kw-close-ack' });
  assert.equal(isCloseAckMessage(closeAckMessage()), true);
  assert.equal(isCloseAckMessage(null), false);
  assert.equal(isCloseAckMessage(42), false);
  assert.equal(isCloseAckMessage({ type: 'nope' }), false);
});

test('closeMessage / isCloseMessage round-trip', () => {
  assert.deepEqual(closeMessage(), { type: 'kw-close' });
  assert.equal(isCloseMessage(closeMessage()), true);
  assert.equal(isCloseMessage(null), false);
  assert.equal(isCloseMessage(42), false);
  assert.equal(isCloseMessage({ type: 'nope' }), false);
});
