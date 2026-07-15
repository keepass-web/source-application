import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeVersionLabel, renderVersionFragment } from '../src/version-label.ts';

// ---------------------------------------------------------------------------
// computeVersionLabel()
// ---------------------------------------------------------------------------

test('computeVersionLabel: an exact vX.Y.Z tag push links to that tree', () => {
  const result = computeVersionLabel({ refType: 'tag', refName: 'v0.4.0', sha: 'deadbeef' });
  assert.deepEqual(result, {
    label: 'v0.4.0',
    url: 'https://github.com/keepass-web/source-application/tree/v0.4.0',
  });
});

test('computeVersionLabel: a tag ref that does not match vX.Y.Z falls back to the sha', () => {
  const sha = 'c'.repeat(40);
  const result = computeVersionLabel({ refType: 'tag', refName: 'not-a-version', sha });
  assert.deepEqual(result, {
    label: `sha:${sha.slice(0, 12)}`,
    url: `https://github.com/keepass-web/source-application/commit/${sha}`,
  });
});

test('computeVersionLabel: a non-tag ref with a sha links to that commit as a short sha label', () => {
  const sha = 'd'.repeat(40);
  const result = computeVersionLabel({ refType: 'branch', refName: 'main', sha });
  assert.deepEqual(result, {
    label: `sha:${sha.slice(0, 12)}`,
    url: `https://github.com/keepass-web/source-application/commit/${sha}`,
  });
});

test('computeVersionLabel: no ref and no sha is an unlinked development build', () => {
  const result = computeVersionLabel({});
  assert.deepEqual(result, { label: 'development build', url: null });
});

test('computeVersionLabel: an empty sha is treated the same as no sha', () => {
  const result = computeVersionLabel({ sha: '' });
  assert.deepEqual(result, { label: 'development build', url: null });
});

// ---------------------------------------------------------------------------
// renderVersionFragment()
// ---------------------------------------------------------------------------

test('renderVersionFragment: linked label with a commit date adds a locale-formatting script', () => {
  const html = renderVersionFragment(
    { label: 'v0.4.0', url: 'https://example.com/tree/v0.4.0' },
    '2026-07-01T12:00:00Z',
  );
  assert.equal(
    html,
    '<a href="https://example.com/tree/v0.4.0">v0.4.0</a> committed on ' +
      '<time id="commit-date" datetime="2026-07-01T12:00:00Z">2026-07-01T12:00:00Z</time>' +
      "<script>document.getElementById('commit-date').textContent = " +
      "new Date(document.getElementById('commit-date').getAttribute('datetime')).toLocaleString();</script>",
  );
});

test('renderVersionFragment: linked label without a commit date omits the time element and script', () => {
  const html = renderVersionFragment({ label: 'v0.4.0', url: 'https://example.com/tree/v0.4.0' });
  assert.equal(html, '<a href="https://example.com/tree/v0.4.0">v0.4.0</a>');
});

test('renderVersionFragment: unlinked label renders plain text', () => {
  const html = renderVersionFragment({ label: 'development build', url: null });
  assert.equal(html, 'development build');
});

test('renderVersionFragment: unlinked label with a commit date still shows it', () => {
  const html = renderVersionFragment(
    { label: 'sha:abc123def456', url: null },
    '2026-07-01T12:00:00Z',
  );
  assert.ok(html.startsWith('sha:abc123def456 committed on '));
});

test('renderVersionFragment: an empty commit date string is treated as absent', () => {
  const html = renderVersionFragment({ label: 'development build', url: null }, '');
  assert.equal(html, 'development build');
});
