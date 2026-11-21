/**
 * Each page writes its palette twice (#196): as light-dark() pairs, which follow
 * the browser's dark mode preference, and as plain light values for a browser
 * without light-dark(), which would otherwise lose every brand color. The second
 * list is a copy of the first, so this keeps the copy from drifting.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const FALLBACK = /@supports not \(color: light-dark\(red, red\)\) \{\s*:root \{([^}]*)\}/;

for (const page of ['0x67', 'local', 'cloud-google-drive', 'index']) {
  test(`${page}: a browser without light-dark() gets the light palette, token for token`, () => {
    const css = readFileSync(new URL(`../${page}/page.css`, import.meta.url), 'utf8');
    const light = new Map(
      [...css.matchAll(/^ {2}(--[\w-]+): light-dark\((#[0-9a-f]{6}), #[0-9a-f]{6}\);$/gm)].map(
        (match) => [match[1], match[2]],
      ),
    );
    const fallback = css.match(FALLBACK)?.[1] ?? '';
    const plain = new Map(
      [...fallback.matchAll(/^ {4}(--[\w-]+): (#[0-9a-f]{6});$/gm)].map((match) => [
        match[1],
        match[2],
      ]),
    );

    assert.ok(light.size > 0, 'the page declares its palette as light-dark() pairs');
    assert.deepEqual(plain, light, 'the fallback repeats every light value');
    assert.match(fallback, /color-scheme: light;/, 'and draws the browser’s own controls light');
  });
}
