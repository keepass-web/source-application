import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Minimal CLI smoke test, mirroring inliner/tests/build.test.ts's pattern.
 *
 * This exists so index.ts (the CLI entry) has *some* coverage: on the
 * no-args path it calls process.exit(1) at module scope, which — unlike a
 * thrown exception — can't be caught, so it can't be safely force-imported
 * the way tests/coverage.test.ts imports the rest of src/ (see that file).
 * Running it as a subprocess is the only safe way to exercise it, and
 * node:test's coverage collector picks up subprocess coverage automatically
 * via NODE_V8_COVERAGE, so this is enough to get index.ts itself counted.
 *
 * This does NOT exercise bundle()'s own logic beyond one straight-line
 * success path — stripModuleSyntax's individual regex branches, multi-file
 * ordering, etc. are a real, separate coverage gap, tracked by
 * tests/coverage.test.ts's report same as any other untested branch.
 */

const indexPath = fileURLToPath(new URL('../src/index.ts', import.meta.url));

function tempDir(): string {
  const dir = join(tmpdir(), `bundle-iife-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runCLI(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', indexPath, ...args], {
      stdio: 'pipe',
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

test('CLI: exits 1 and prints usage when no config path is given', async () => {
  const { code, stderr } = await runCLI([]);
  assert.equal(code, 1);
  assert.ok(stderr.includes('Usage:'), `expected usage message, got: ${stderr}`);
});

test('CLI: exits 0 and bundles files on success', async () => {
  const dir = tempDir();
  mkdirSync(join(dir, 'packages', 'demo', 'dist', 'src'), { recursive: true });
  writeFileSync(
    join(dir, 'packages', 'demo', 'dist', 'src', 'index.js'),
    'export function demo() { return 1; }\n',
    'utf8',
  );
  writeFileSync(
    join(dir, 'bundle-iife.json'),
    JSON.stringify({
      packagesDir: 'packages',
      files: ['demo/dist/src/index.js'],
      exports: ['demo'],
      output: 'out.js',
    }),
    'utf8',
  );

  const { code, stdout } = await runCLI([join(dir, 'bundle-iife.json')]);
  assert.equal(code, 0);
  assert.ok(stdout.startsWith('Bundled '), `expected "Bundled " prefix, got: ${stdout}`);
});
