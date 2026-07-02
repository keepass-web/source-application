import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from '../src/build.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tempDir(): string {
  const dir = join(tmpdir(), `inliner-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function write(dir: string, name: string, content: string): void {
  writeFileSync(join(dir, name), content, 'utf8');
}

function manifest(dir: string, fields: object): void {
  write(dir, 'build.json', JSON.stringify(fields));
}

function sha256(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

const indexPath = fileURLToPath(new URL('../src/index.ts', import.meta.url));

function runCLI(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--experimental-strip-types', indexPath, ...args],
      { stdio: 'pipe' },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => { resolve({ code: code ?? 1, stdout, stderr }); });
  });
}

// ---------------------------------------------------------------------------
// build()
// ---------------------------------------------------------------------------

test('inlines style and script into the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--STYLES--><!--SCRIPTS--></html>');
  write(dir, 'style.css', 'body { color: red; }');
  write(dir, 'script.js', 'console.log(1);');
  manifest(dir, { template: 'template.html', styles: ['style.css'], scripts: ['script.js'], output: 'out.html' });

  const checksum = build(join(dir, 'build.json'));

  const expected =
    '<html><style>\nbody { color: red; }\n</style><script>\nconsole.log(1);\n</script></html>';
  assert.equal(readFileSync(join(dir, 'out.html'), 'utf8'), expected);
  assert.equal(checksum, sha256(expected));
});

test('concatenates multiple CSS files in manifest order', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<!--STYLES--><!--SCRIPTS-->');
  write(dir, 'a.css', '.a {}');
  write(dir, 'b.css', '.b {}');
  manifest(dir, { template: 'template.html', styles: ['a.css', 'b.css'], scripts: [], output: 'out.html' });

  build(join(dir, 'build.json'));

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(result.indexOf('.a {}') < result.indexOf('.b {}'), '.a {} must precede .b {}');
});

test('concatenates multiple JS files in manifest order', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<!--STYLES--><!--SCRIPTS-->');
  write(dir, 'a.js', 'const a = 1;');
  write(dir, 'b.js', 'const b = 2;');
  manifest(dir, { template: 'template.html', styles: [], scripts: ['a.js', 'b.js'], output: 'out.html' });

  build(join(dir, 'build.json'));

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(result.indexOf('const a') < result.indexOf('const b'), 'a must precede b');
});

test('creates the output directory when it does not exist', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<!--STYLES--><!--SCRIPTS-->');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'deep/nested/out.html' });

  assert.doesNotThrow(() => build(join(dir, 'build.json')));
  assert.ok(readFileSync(join(dir, 'deep', 'nested', 'out.html'), 'utf8').length > 0);
});

test('throws when the STYLES sentinel is absent from the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--SCRIPTS--></html>');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  assert.throws(
    () => build(join(dir, 'build.json')),
    /missing the required sentinel: <!--STYLES-->/,
  );
});

test('throws when the SCRIPTS sentinel is absent from the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--STYLES--></html>');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  assert.throws(
    () => build(join(dir, 'build.json')),
    /missing the required sentinel: <!--SCRIPTS-->/,
  );
});

// ---------------------------------------------------------------------------
// CLI (index.ts)
// ---------------------------------------------------------------------------

test('CLI: exits 1 and prints usage when no manifest path is given', async () => {
  const { code, stderr } = await runCLI([]);
  assert.equal(code, 1);
  assert.ok(stderr.includes('Usage:'), `expected usage message, got: ${stderr}`);
});

test('CLI: exits 0 and prints sha256 checksum on success', async () => {
  const dir = tempDir();
  write(dir, 'template.html', '<!--STYLES--><!--SCRIPTS-->');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  const { code, stdout } = await runCLI([join(dir, 'build.json')]);
  assert.equal(code, 0);
  assert.ok(stdout.startsWith('sha256:'), `expected sha256: prefix, got: ${stdout}`);
  assert.match(stdout.trim(), /^sha256:[0-9a-f]{64}$/);
});
