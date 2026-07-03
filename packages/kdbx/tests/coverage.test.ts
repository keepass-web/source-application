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
 * Importing every file under src/ here closes that hole: once a file is
 * loaded, any of its untested lines/branches/functions are visible in the
 * report and do fail the threshold, the same as an untested branch in a file
 * that's already exercised elsewhere.
 */

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      yield full;
    }
  }
}

test('every src module loads, so an untested file cannot hide from coverage', async () => {
  for await (const file of walk(srcDir)) {
    await import(pathToFileURL(file).href);
  }
});
