import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChaCha20, chacha20, chacha20Block, Salsa20, salsa20, salsa20Block } from '../src/index.ts';

function fromHex(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function range(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = i & 0xff;
  }
  return out;
}

// Deterministic pseudo-random filler (no crypto dependency in tests).
function filler(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = (i * 73 + 11) & 0xff;
  }
  return out;
}

const ZERO_KEY = new Uint8Array(32);
const ZERO_NONCE_12 = new Uint8Array(12);

// ---------------------------------------------------------------------------
// ChaCha20 — RFC 8439 test vectors.
// ---------------------------------------------------------------------------

test('chacha20Block matches RFC 8439 Appendix A.1 vector #1 (counter 0)', () => {
  const expected = fromHex(
    '76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7' +
      'da41597c5157488d7724e03fb8d84a376a43b8f41518a11cc387b669b2ee6586',
  );
  assert.deepEqual(chacha20Block(ZERO_KEY, ZERO_NONCE_12, 0), expected);
});

test('chacha20Block matches RFC 8439 Appendix A.1 vector #2 (counter 1)', () => {
  const expected = fromHex(
    '9f07e7be5551387a98ba977c732d080dcb0f29a048e3656912c6533e32ee7aed' +
      '29b721769ce64e43d57133b074d839d531ed1f28510afb45ace10a1f4b794d6f',
  );
  assert.deepEqual(chacha20Block(ZERO_KEY, ZERO_NONCE_12, 1), expected);
});

test('chacha20Block matches RFC 8439 §2.3.2 vector', () => {
  const nonce = fromHex('000000090000004a00000000');
  const expected = fromHex(
    '10f1e7e4d13b5915500fdd1fa32071c4c7d1f4c733c068030422aa9ac3d46c4e' +
      'd2826446079faa0914c2d705d98b02a2b5129cd1de164eb9cbd083e8a2503c4e',
  );
  assert.deepEqual(chacha20Block(range(32), nonce, 1), expected);
});

test('chacha20 encrypts the RFC 8439 §2.4.2 sunscreen vector', () => {
  const nonce = fromHex('000000000000004a00000000');
  const plaintext = new TextEncoder().encode(
    "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
  );
  const expected = fromHex(
    '6e2e359a2568f98041ba0728dd0d6981e97e7aec1d4360c20a27afccfd9fae0b' +
      'f91b65c5524733ab8f593dabcd62b3571639d624e65152ab8f530c359f0861d8' +
      '07ca0dbf500d6a6156a38e088a22b65e52bc514d16ccf806818ce91ab7793736' +
      '5af90bbf74a35be6b40b8eedf2785e42874d',
  );
  assert.deepEqual(chacha20(range(32), nonce, plaintext, 1), expected);
});

test('chacha20 decryption is the inverse of encryption', () => {
  const key = filler(32);
  const nonce = filler(12);
  const plaintext = filler(257);
  const ciphertext = chacha20(key, nonce, plaintext, 7);
  assert.notDeepEqual(ciphertext, plaintext);
  assert.deepEqual(chacha20(key, nonce, ciphertext, 7), plaintext);
});

// ---------------------------------------------------------------------------
// Salsa20 — eSTREAM published vector.
// ---------------------------------------------------------------------------

test('salsa20Block matches the eSTREAM Salsa20/20 256-bit Set 1 vector #0', () => {
  // key = 0x80 followed by 31 zero bytes, IV = 0; first 64 keystream bytes.
  const key = new Uint8Array(32);
  key[0] = 0x80;
  const nonce = new Uint8Array(8);
  const expected = fromHex(
    'e3be8fdd8beca2e3ea8ef9475b29a6e7003951e1097a5c38d23b7a5fad9f6844' +
      'b22c97559e2723c7cbbd3fe4fc8d9a0744652a83e72a9c461876af4d7ef1a117',
  );
  assert.deepEqual(salsa20Block(key, nonce, 0), expected);
});

test('salsa20 keystream equals the block function for the first block', () => {
  const key = new Uint8Array(32);
  key[0] = 0x80;
  const nonce = new Uint8Array(8);
  const keystream = salsa20(key, nonce, new Uint8Array(64));
  assert.deepEqual(keystream, salsa20Block(key, nonce, 0));
});

test('salsa20 decryption is the inverse of encryption', () => {
  const key = filler(32);
  const nonce = filler(8);
  const plaintext = filler(200);
  const ciphertext = salsa20(key, nonce, plaintext);
  assert.notDeepEqual(ciphertext, plaintext);
  assert.deepEqual(salsa20(key, nonce, ciphertext), plaintext);
});

// ---------------------------------------------------------------------------
// Stateful classes — continuous keystream across calls (KDBX inner-stream use).
// ---------------------------------------------------------------------------

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

test('ChaCha20 streamed in chunks equals a single one-shot call', () => {
  const key = filler(32);
  const nonce = filler(12);
  const data = filler(300);
  const cipher = new ChaCha20(key, nonce, 0);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of [10, 54, 1, 100, 135]) {
    chunks.push(cipher.encrypt(data.subarray(offset, offset + size)));
    offset += size;
  }
  assert.deepEqual(concat(chunks), chacha20(key, nonce, data, 0));
});

test('Salsa20 streamed in chunks equals a single one-shot call', () => {
  const key = filler(32);
  const nonce = filler(8);
  const data = filler(300);
  const cipher = new Salsa20(key, nonce, 0);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of [7, 57, 64, 65, 107]) {
    chunks.push(cipher.encrypt(data.subarray(offset, offset + size)));
    offset += size;
  }
  assert.deepEqual(concat(chunks), salsa20(key, nonce, data, 0));
});

test('ChaCha20 decrypt undoes a streamed encryption (mixed chunking)', () => {
  const key = filler(32);
  const nonce = filler(12);
  const plaintext = filler(150);
  const ciphertext = new ChaCha20(key, nonce).encrypt(plaintext);
  const decryptor = new ChaCha20(key, nonce);
  const recovered = concat([
    decryptor.decrypt(ciphertext.subarray(0, 40)),
    decryptor.decrypt(ciphertext.subarray(40, 150)),
  ]);
  assert.deepEqual(recovered, plaintext);
});

// ---------------------------------------------------------------------------
// Input validation.
// ---------------------------------------------------------------------------

test('rejects keys and nonces of the wrong length', () => {
  assert.throws(() => chacha20Block(new Uint8Array(16), ZERO_NONCE_12, 0), RangeError);
  assert.throws(() => chacha20Block(ZERO_KEY, new Uint8Array(8), 0), RangeError);
  assert.throws(() => salsa20Block(ZERO_KEY, new Uint8Array(12), 0), RangeError);
  assert.throws(() => new ChaCha20(ZERO_KEY, new Uint8Array(8)), RangeError);
  assert.throws(() => new Salsa20(ZERO_KEY, new Uint8Array(12)), RangeError);
});
