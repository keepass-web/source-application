import assert from 'node:assert/strict';
import { test } from 'node:test';
import { must, verifyCommand } from '../index/logic.ts';

test('must passes a present value through unchanged', () => {
  assert.equal(must(42), 42);
  assert.equal(must('x'), 'x');
});

test('must throws for null or undefined', () => {
  assert.throws(() => must(null), /expected element not found/);
  assert.throws(() => must(undefined), /expected element not found/);
});

test('verifyCommand skips the download step for a file already on disk', () => {
  assert.equal(
    verifyCommand('file:', 'null'),
    'gh attestation verify index.html --repo keepass-web/source-application',
  );
});

test('verifyCommand adds a download step for a hosted origin', () => {
  assert.equal(
    verifyCommand('https:', 'https://keepass-web.app'),
    'curl -O https://keepass-web.app/index.html\ngh attestation verify index.html --repo keepass-web/source-application',
  );
});
