import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * check.js is a plain CLI script (see its own doc comment for why: no
 * network access, so unlike ruleset/check.js it doesn't need the
 * "no automated tests" exception from docs/CONTRIBUTING.md). It's run as a
 * subprocess rather than imported directly, matching bundle-iife and
 * inliner's index.ts tests: node:test's coverage collector picks up
 * subprocess coverage automatically via NODE_V8_COVERAGE.
 */

const checkPath = fileURLToPath(new URL('../check.js', import.meta.url));

function tempLockfile(packages: Record<string, unknown>): string {
  const dir = join(
    tmpdir(),
    `dependency-policy-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'package-lock.json');
  writeFileSync(path, JSON.stringify({ lockfileVersion: 3, packages }), 'utf8');
  return path;
}

function runCLI(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [checkPath, ...args], { stdio: 'pipe' });
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

test('CLI: exits 0 when no package has an install script', async () => {
  const lockfilePath = tempLockfile({
    '': { name: 'source-application', version: '0.1.0' },
    'node_modules/typescript': { version: '6.0.3' },
  });

  const { code, stdout } = await runCLI([lockfilePath]);
  assert.equal(code, 0);
  assert.ok(stdout.includes('passed'), `expected a pass message, got: ${stdout}`);
});

test('CLI: exits 1 and names the offender when a package has an install script', async () => {
  const lockfilePath = tempLockfile({
    '': { name: 'source-application', version: '0.1.0' },
    'node_modules/sketchy-binary': { version: '1.2.3', hasInstallScript: true },
  });

  const { code, stderr } = await runCLI([lockfilePath]);
  assert.equal(code, 1);
  assert.ok(
    stderr.includes('node_modules/sketchy-binary'),
    `expected offender name, got: ${stderr}`,
  );
  assert.ok(stderr.includes('not allow-listed'), `expected policy wording, got: ${stderr}`);
});

test('CLI: defaults to the repo root package-lock.json when no path is given', async () => {
  const { code, stdout } = await runCLI([]);
  assert.equal(code, 0);
  assert.ok(stdout.includes('passed'), `expected a pass message, got: ${stdout}`);
});
