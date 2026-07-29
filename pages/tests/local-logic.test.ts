import assert from 'node:assert/strict';
import { test } from 'node:test';
import { must } from '../local/logic.ts';

test('must passes a present value through unchanged', () => {
  assert.equal(must(42), 42);
  assert.equal(must('x'), 'x');
});

test('must throws for null or undefined', () => {
  assert.throws(() => must(null), /expected element not found/);
  assert.throws(() => must(undefined), /expected element not found/);
});
