import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blake2b } from '../src/blake2b.ts';
import { argon2, argon2d, argon2id } from '../src/index.ts';

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function filled(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

// RFC 7693, Appendix A: BLAKE2b-512 of "abc".
test('blake2b matches RFC 7693 test vector', () => {
  const digest = blake2b(64, new TextEncoder().encode('abc'));
  assert.equal(
    hex(digest),
    'ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d1' +
      '7d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923',
  );
});

// RFC 9106, Appendix B (Section 5). Shared parameters for the test vectors.
const VECTOR = {
  password: filled(32, 0x01),
  salt: filled(16, 0x02),
  secret: filled(8, 0x03),
  associatedData: filled(12, 0x04),
  parallelism: 4,
  memory: 32,
  iterations: 3,
  tagLength: 32,
  version: 0x13,
} as const;

test('argon2d matches RFC 9106 test vector', () => {
  const tag = argon2({ ...VECTOR, type: 'argon2d' });
  assert.equal(hex(tag), '512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb');
});

test('argon2id matches RFC 9106 test vector', () => {
  const tag = argon2({ ...VECTOR, type: 'argon2id' });
  assert.equal(hex(tag), '0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
});

test('argon2d/argon2id wrappers match argon2(type)', () => {
  assert.deepEqual(argon2d(VECTOR), argon2({ ...VECTOR, type: 'argon2d' }));
  assert.deepEqual(argon2id(VECTOR), argon2({ ...VECTOR, type: 'argon2id' }));
});

test('omitting optional secret/associatedData is allowed', () => {
  const tag = argon2id({
    password: filled(8, 0x00),
    salt: filled(16, 0x02),
    parallelism: 1,
    memory: 8,
    iterations: 1,
    tagLength: 32,
  });
  assert.equal(tag.length, 32);
});

test('rejects out-of-range parameters', () => {
  const base = { password: filled(8, 0), salt: filled(8, 0), parallelism: 1, iterations: 1 };
  assert.throws(() => argon2id({ ...base, memory: 8, tagLength: 3 }), RangeError); // tag too short
  assert.throws(() => argon2id({ ...base, memory: 4, tagLength: 32 }), RangeError); // memory < 8*p
  assert.throws(() => argon2id({ ...base, memory: 8, iterations: 0, tagLength: 32 }), RangeError);
  assert.throws(
    () => argon2({ ...base, memory: 8, tagLength: 32, type: 'argon2i' as never }),
    RangeError,
  ); // Argon2i unsupported
});
