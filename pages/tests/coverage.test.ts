import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * node:test's coverage collector only reports on files V8 actually loads
 * during the run — a source file with zero tests doesn't show up as 0%, it
 * doesn't show up at all, and the overall percentage is computed only over
 * what *is* loaded. That means a completely untested file can't fail the
 * --test-coverage-* thresholds; it just silently doesn't count. See
 * docs/CONTRIBUTING.md.
 *
 * Importing every page module here closes that hole for any page module
 * without its own dedicated test file. 0x67/page.ts calls real DOM APIs at
 * module scope (see its "Boot" section), so importing it here under plain
 * Node (no DOM) throws immediately — left to throw on purpose, since V8
 * still records coverage for whatever ran before the throw. Its real
 * coverage comes from tests/0x67-page.test.ts (jsdom-based); this file's
 * import of it is a harmless, redundant repeat.
 */

const pagesRoot = fileURLToPath(new URL('..', import.meta.url));

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'tests' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      yield full;
    }
  }
}

test('every page module loads, so an untested file cannot hide from coverage', async (t) => {
  for await (const file of walk(pagesRoot)) {
    try {
      await import(pathToFileURL(file).href);
    } catch (err) {
      // Loading still instruments whatever ran before the throw, so the
      // file shows up in the coverage report at its real percentage rather
      // than vanishing. Diagnostic only — not a failure of this test.
      t.diagnostic(
        `${file} threw on import (expected for browser-only modules): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
});
