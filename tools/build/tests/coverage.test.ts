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
 * Importing every file under inliner/src and bundle-iife/src closes that
 * hole for everything except each tool's index.ts CLI entry point, which is
 * skipped here on purpose: on the no-args path it calls process.exit(1) at
 * module scope, and unlike a thrown exception, process.exit() can't be
 * caught — force-importing it would kill this entire test run rather than
 * fail one test. Both index.ts files are instead exercised as subprocesses
 * (inliner/tests/build.test.ts, bundle-iife/tests/cli.test.ts), which
 * node:test's coverage collector picks up automatically via
 * NODE_V8_COVERAGE.
 *
 * ruleset/check.js is deliberately out of scope of this walk (and of the
 * --test-coverage-include globs in package.json): it's a live script that
 * calls the GitHub API and process.exit(), not a pure module, so it isn't
 * safely importable either. It currently has no automated tests at all —
 * see docs/CONTRIBUTING.md.
 */

const buildRoot = fileURLToPath(new URL('..', import.meta.url));
const SKIP_BASENAMES = new Set(['index.ts']);

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

test('every inliner/bundle-iife src module loads, so an untested file cannot hide from coverage', async () => {
  for (const tool of ['inliner', 'bundle-iife']) {
    const srcDir = join(buildRoot, tool, 'src');
    for await (const file of walk(srcDir)) {
      if (SKIP_BASENAMES.has(file.split('/').pop() ?? '')) continue;
      await import(pathToFileURL(file).href);
    }
  }
});
