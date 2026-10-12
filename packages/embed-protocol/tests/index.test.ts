import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkedMessage,
  checkMessage,
  closeAckMessage,
  closeMessage,
  closeRequestMessage,
  createMessage,
  findMessage,
  isCheckedMessage,
  isCheckMessage,
  isCloseAckMessage,
  isCloseMessage,
  isCloseRequestMessage,
  isCreateMessage,
  isFindMessage,
  isOpenMessage,
  isReadyMessage,
  isReconnectedMessage,
  isReconnectMessage,
  isSavedMessage,
  isSaveMessage,
  isTitleMessage,
  openMessage,
  peerOrigin,
  readyMessage,
  reconnectedMessage,
  reconnectMessage,
  savedMessage,
  saveMessage,
  titleMessage,
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

test('createMessage / isCreateMessage round-trip', () => {
  assert.deepEqual(createMessage(), { type: 'kw-create' });
  assert.equal(isCreateMessage(createMessage()), true);
  assert.equal(isCreateMessage(null), false);
  assert.equal(isCreateMessage(42), false);
  assert.equal(isCreateMessage({ type: 'nope' }), false);
});

test('saveMessage / isSaveMessage round-trip and reject malformed payloads', () => {
  const bytes = new ArrayBuffer(4);
  const msg = saveMessage(1, 'vault.kdbx', bytes);
  assert.deepEqual(msg, { type: 'kw-save', id: 1, filename: 'vault.kdbx', bytes });
  assert.equal(isSaveMessage(msg), true);
  assert.equal(isSaveMessage(null), false);
  assert.equal(isSaveMessage({ type: 'kw-save', id: 1, filename: 1, bytes }), false);
  assert.equal(isSaveMessage({ type: 'kw-save', id: 1, filename: 'a', bytes: 'no' }), false);
});

test('a save and its result both carry an id, so overlapping saves can be told apart (#91)', () => {
  const bytes = new ArrayBuffer(4);
  assert.equal(isSaveMessage({ type: 'kw-save', filename: 'a', bytes }), false);
  assert.equal(isSaveMessage({ type: 'kw-save', id: '1', filename: 'a', bytes }), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', ok: true }), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', id: '1', ok: true }), false);
});

test('savedMessage / isSavedMessage round-trip, with and without an error', () => {
  const ok = savedMessage(1, true);
  assert.deepEqual(ok, { type: 'kw-saved', id: 1, ok: true });
  assert.equal(isSavedMessage(ok), true);

  const failed = savedMessage(2, false, { error: 'HTTP 403' });
  assert.deepEqual(failed, { type: 'kw-saved', id: 2, ok: false, error: 'HTTP 403' });
  assert.equal(isSavedMessage(failed), true);

  assert.equal(isSavedMessage(null), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', id: 1, ok: 'nope' }), false);
  assert.equal(isSavedMessage({ type: 'kw-saved', id: 1, ok: true, error: 42 }), false);
});

test('a saved failure can name a reason the app acts on, and only a known one', () => {
  const expired = savedMessage(3, false, { error: 'HTTP 401', reason: 'auth-expired' });
  assert.deepEqual(expired, {
    type: 'kw-saved',
    id: 3,
    ok: false,
    error: 'HTTP 401',
    reason: 'auth-expired',
  });
  assert.equal(isSavedMessage(expired), true);

  const saved = (reason: unknown) => ({ type: 'kw-saved', id: 1, ok: false, reason });
  assert.equal(isSavedMessage(saved('auth-expired')), true);
  assert.equal(isSavedMessage(saved('conflict')), true);
  assert.equal(isSavedMessage(saved('whatever')), false);
  assert.equal(isSavedMessage(saved(7)), false);
});

test('an open, a save and a save result can carry the stored version they concern (#74)', () => {
  const bytes = new ArrayBuffer(4);
  const open = openMessage('vault.kdbx', bytes, 'rev-1');
  assert.deepEqual(open, { type: 'kw-open', filename: 'vault.kdbx', bytes, version: 'rev-1' });
  assert.equal(isOpenMessage(open), true);
  assert.equal(isOpenMessage({ ...open, version: 7 }), false);

  const save = saveMessage(1, 'vault.kdbx', bytes, 'rev-1');
  assert.deepEqual(save, { type: 'kw-save', id: 1, filename: 'vault.kdbx', bytes, base: 'rev-1' });
  assert.equal(isSaveMessage(save), true);
  assert.equal(isSaveMessage({ ...save, base: 7 }), false);

  const saved = savedMessage(1, true, { version: 'rev-2' });
  assert.deepEqual(saved, { type: 'kw-saved', id: 1, ok: true, version: 'rev-2' });
  assert.equal(isSavedMessage(saved), true);
  assert.equal(isSavedMessage({ ...saved, version: 7 }), false);
});

test('checkMessage / isCheckMessage round-trip, with and without the version built on (#74)', () => {
  assert.deepEqual(checkMessage(), { type: 'kw-check' });
  assert.deepEqual(checkMessage('rev-1'), { type: 'kw-check', base: 'rev-1' });
  assert.equal(isCheckMessage(checkMessage('rev-1')), true);
  assert.equal(isCheckMessage(checkMessage()), true);
  assert.equal(isCheckMessage({ type: 'kw-check', base: 7 }), false);
  assert.equal(isCheckMessage(null), false);
});

test('checkedMessage / isCheckedMessage: a newer version always comes with its bytes (#74)', () => {
  const bytes = new ArrayBuffer(4);
  for (const status of ['unchanged', 'gone', 'unknown'] as const) {
    assert.deepEqual(checkedMessage(status), { type: 'kw-checked', status });
    assert.equal(isCheckedMessage(checkedMessage(status)), true);
  }
  const newer = checkedMessage('newer', {
    bytes,
    version: 'rev-2',
    savedAt: '2026-10-11T12:00:00Z',
  });
  assert.deepEqual(newer, {
    type: 'kw-checked',
    status: 'newer',
    bytes,
    version: 'rev-2',
    savedAt: '2026-10-11T12:00:00Z',
  });
  assert.equal(isCheckedMessage(newer), true);
  assert.equal(isCheckedMessage(checkedMessage('newer', { bytes, version: 'rev-2' })), true);
  assert.equal(isCheckedMessage({ type: 'kw-checked', status: 'newer', version: 'rev-2' }), false);
  assert.equal(isCheckedMessage({ type: 'kw-checked', status: 'newer', bytes }), false);
  assert.equal(
    isCheckedMessage({ type: 'kw-checked', status: 'newer', bytes, version: '' }),
    false,
    'a newer version always has a name to build on',
  );
  assert.equal(isCheckedMessage({ ...newer, savedAt: 7 }), false);
  assert.equal(isCheckedMessage({ type: 'kw-checked', status: 'whatever' }), false);
  assert.equal(isCheckedMessage(null), false);
});

test('reconnectMessage / isReconnectMessage round-trip', () => {
  const message = reconnectMessage();
  assert.deepEqual(message, { type: 'kw-reconnect' });
  assert.equal(isReconnectMessage(message), true);
  assert.equal(isReconnectMessage({ type: 'kw-close' }), false);
});

test('reconnectedMessage / isReconnectedMessage round-trip, with and without an error', () => {
  const ok = reconnectedMessage(true);
  assert.deepEqual(ok, { type: 'kw-reconnected', ok: true });
  assert.equal(isReconnectedMessage(ok), true);

  const refused = reconnectedMessage(false, 'popup blocked');
  assert.deepEqual(refused, { type: 'kw-reconnected', ok: false, error: 'popup blocked' });
  assert.equal(isReconnectedMessage(refused), true);

  assert.equal(isReconnectedMessage(null), false);
  assert.equal(isReconnectedMessage({ type: 'kw-reconnected', ok: 'nope' }), false);
  assert.equal(isReconnectedMessage({ type: 'kw-reconnected', ok: true, error: 42 }), false);
});

test('titleMessage / isTitleMessage round-trip', () => {
  assert.deepEqual(titleMessage('vault.kdbx', true), {
    type: 'kw-title',
    filename: 'vault.kdbx',
    locked: true,
  });
  assert.equal(isTitleMessage(titleMessage('vault.kdbx', false)), true);
  assert.equal(isTitleMessage(null), false);
  assert.equal(isTitleMessage({ type: 'kw-title', filename: 'vault.kdbx' }), false);
  assert.equal(isTitleMessage({ type: 'kw-title', filename: 42, locked: true }), false);
});

test('findMessage / isFindMessage round-trip', () => {
  assert.deepEqual(findMessage(), { type: 'kw-find' });
  assert.equal(isFindMessage(findMessage()), true);
  assert.equal(isFindMessage(null), false);
  assert.equal(isFindMessage(42), false);
  assert.equal(isFindMessage({ type: 'nope' }), false);
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

test('peerOrigin names the origin when served', () => {
  assert.deepEqual(peerOrigin('https:', 'https://keepass-web.app'), {
    target: 'https://keepass-web.app',
    accept: 'https://keepass-web.app',
  });
  assert.deepEqual(peerOrigin('http:', 'http://localhost:8080'), {
    target: 'http://localhost:8080',
    accept: 'http://localhost:8080',
  });
});

// Chrome and Safari report location.origin as "file://" here and Firefox as "null"; both arrive
// as "null", so the accepted value cannot be derived from the origin the page reads for itself.
test('peerOrigin widens on file://, whichever origin the browser reports', () => {
  assert.deepEqual(peerOrigin('file:', 'file://'), { target: '*', accept: 'null' });
  assert.deepEqual(peerOrigin('file:', 'null'), { target: '*', accept: 'null' });
});
