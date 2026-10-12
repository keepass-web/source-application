/**
 * Every link that leaves the site, from any page or the shared footer, opens
 * in a new tab that gets no referrer and no handle back to this one (issue
 * #116), so following it never navigates away from the page or a database
 * open in it. Scans every .html one directory down, so a new page is covered
 * without being listed here.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const pagesDir = fileURLToPath(new URL('..', import.meta.url));
const markupFiles = readdirSync(pagesDir, { withFileTypes: true })
  .filter((dir) => dir.isDirectory() && dir.name !== 'node_modules')
  .flatMap((dir) =>
    readdirSync(join(pagesDir, dir.name))
      .filter((name) => name.endsWith('.html'))
      .map((name) => `${dir.name}/${name}`),
  );

test('every link out of the site opens in a new tab, cut off from this one', () => {
  let outbound = 0;
  for (const file of markupFiles) {
    const doc = new JSDOM(readFileSync(join(pagesDir, file), 'utf8')).window.document;
    for (const link of doc.querySelectorAll('a')) {
      if (!/^(https?:)?\/\//i.test(link.getAttribute('href') ?? '')) continue;
      outbound++;
      const where = `${file}: ${link.href}`;
      assert.equal(link.target, '_blank', where);
      assert.ok(link.relList.contains('noopener'), where);
      assert.ok(link.relList.contains('noreferrer'), where);
    }
  }
  assert.ok(markupFiles.includes('shared/footer.html'), 'the footer is scanned');
  assert.ok(outbound > 0, 'the pages link out somewhere');
});
