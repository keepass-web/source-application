/**
 * Unit tests for cloud-google-drive/logic.ts — the connector's pure OAuth/PKCE,
 * Drive-URL, token-parsing, and message-guard helpers. All DOM-free, so
 * exercised directly here (contrast cloud-google-drive-page.test.ts, which
 * drives page.ts through jsdom).
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  base64UrlEncode,
  buildAuthUrl,
  buildDriveDownloadUrl,
  buildDriveUpdateUrl,
  buildTokenRequestBody,
  isOAuthMessage,
  isPopupCallback,
  isReadyMessage,
  isSaveMessage,
  must,
  parseCallbackParams,
  parseTokenResponse,
  sha256Base64Url,
} from '../cloud-google-drive/logic.ts';

test('must returns a present value and throws on null/undefined', () => {
  assert.equal(must('x'), 'x');
  assert.equal(must(0), 0);
  assert.throws(() => must(null), /expected element not found/);
  assert.throws(() => must(undefined), /expected element not found/);
});

test('base64UrlEncode is URL-safe and unpadded', () => {
  // 0xff 0xff 0xff -> "////" -> "____"; 0xff -> "/w==" -> "_w".
  assert.equal(base64UrlEncode(new Uint8Array([0xff, 0xff, 0xff])), '____');
  assert.equal(base64UrlEncode(new Uint8Array([0xff])), '_w');
  const encoded = base64UrlEncode(new Uint8Array([0, 1, 2, 3, 250, 251, 252, 253]));
  assert.doesNotMatch(encoded, /[+/=]/);
});

test('sha256Base64Url matches an independent SHA-256 oracle', async () => {
  const challenge = await sha256Base64Url('abc');
  const expected = createHash('sha256')
    .update('abc')
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert.equal(challenge, expected);
});

test('parseCallbackParams reads code/state/error, or null when absent', () => {
  assert.deepEqual(parseCallbackParams('?code=abc&state=xyz'), {
    code: 'abc',
    state: 'xyz',
    error: null,
  });
  assert.deepEqual(parseCallbackParams('?error=access_denied'), {
    code: null,
    state: null,
    error: 'access_denied',
  });
  assert.deepEqual(parseCallbackParams(''), { code: null, state: null, error: null });
});

test('buildAuthUrl assembles the PKCE authorization request', () => {
  const url = new URL(
    buildAuthUrl({
      authEndpoint: 'https://auth.example/authorize',
      clientId: 'cid',
      redirectUri: 'https://app.example/cb',
      scope: 'drive.file',
      state: 'st',
      codeChallenge: 'chal',
    }),
  );
  assert.equal(url.origin + url.pathname, 'https://auth.example/authorize');
  assert.equal(url.searchParams.get('client_id'), 'cid');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://app.example/cb');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('scope'), 'drive.file');
  assert.equal(url.searchParams.get('state'), 'st');
  assert.equal(url.searchParams.get('code_challenge'), 'chal');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
});

test('buildTokenRequestBody assembles the code-exchange form body', () => {
  const params = new URLSearchParams(
    buildTokenRequestBody({
      clientId: 'cid',
      code: 'the-code',
      redirectUri: 'https://app.example/cb',
      codeVerifier: 'ver',
    }),
  );
  assert.equal(params.get('client_id'), 'cid');
  assert.equal(params.get('code'), 'the-code');
  assert.equal(params.get('redirect_uri'), 'https://app.example/cb');
  assert.equal(params.get('grant_type'), 'authorization_code');
  assert.equal(params.get('code_verifier'), 'ver');
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

test('parseTokenResponse extracts a string access token, else throws', () => {
  assert.deepEqual(parseTokenResponse({ access_token: 'tok' }), { accessToken: 'tok' });
  assert.throws(() => parseTokenResponse(null), /no access token/);
  assert.throws(() => parseTokenResponse('nope'), /no access token/);
  assert.throws(() => parseTokenResponse({}), /no access token/);
  assert.throws(() => parseTokenResponse({ access_token: 42 }), /no access token/);
});

test('isPopupCallback is true only with an opener and a code or error', () => {
  assert.equal(isPopupCallback(false, { code: 'c', error: null }), false);
  assert.equal(isPopupCallback(true, { code: 'c', error: null }), true);
  assert.equal(isPopupCallback(true, { code: null, error: 'denied' }), true);
  assert.equal(isPopupCallback(true, { code: null, error: null }), false);
});

test('isOAuthMessage recognises the popup callback shape', () => {
  assert.equal(isOAuthMessage({ type: 'kw-oauth', code: 'c', state: 's', error: null }), true);
  assert.equal(isOAuthMessage(null), false);
  assert.equal(isOAuthMessage('kw-oauth'), false);
  assert.equal(isOAuthMessage({ type: 'other' }), false);
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
