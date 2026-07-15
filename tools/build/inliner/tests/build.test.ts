import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

// The version-label env vars mirror GitHub Actions' own names, which means
// they're present for real whenever this suite runs inside Actions. Every
// test below needs a known, deterministic value for them regardless of what
// CI happens to be running under, so this list is scrubbed to a fixed state
// (by default, entirely absent) before each build() call and CLI spawn.
const VERSION_ENV_KEYS = [
  'GITHUB_REF_TYPE',
  'GITHUB_REF_NAME',
  'GITHUB_SHA',
  'KEEPASS_WEB_COMMIT_DATE',
] as const;

function withVersionEnv<T>(
  overrides: Partial<Record<(typeof VERSION_ENV_KEYS)[number], string>>,
  fn: () => T,
): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of VERSION_ENV_KEYS) {
    previous[key] = process.env[key];
    const value = overrides[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return fn();
  } finally {
    for (const key of VERSION_ENV_KEYS) {
      if (previous[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previous[key];
      }
    }
  }
}

function runCLI(
  args: string[],
  env: Partial<Record<(typeof VERSION_ENV_KEYS)[number], string>> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scrubbed: NodeJS.ProcessEnv = { ...process.env };
  for (const key of VERSION_ENV_KEYS) {
    delete scrubbed[key];
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', indexPath, ...args], {
      stdio: 'pipe',
      env: { ...scrubbed, ...env },
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

const SENTINELS = '<!--STYLES--><!--SCRIPTS--><!--VERSION-->';

// ---------------------------------------------------------------------------
// build()
// ---------------------------------------------------------------------------

test('inlines style and script into the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', `<html>${SENTINELS}</html>`);
  write(dir, 'style.css', 'body { color: red; }');
  write(dir, 'script.js', 'console.log(1);');
  manifest(dir, {
    template: 'template.html',
    styles: ['style.css'],
    scripts: ['script.js'],
    output: 'out.html',
  });

  const { checksum, outputPath } = withVersionEnv({}, () => build(join(dir, 'build.json')));

  const expected =
    '<html><style>\nbody { color: red; }\n</style><script>\nconsole.log(1);\n</script>development build</html>';
  assert.equal(readFileSync(join(dir, 'out.html'), 'utf8'), expected);
  assert.equal(checksum, sha256(expected));
  assert.equal(outputPath, join(dir, 'out.html'));
});

test('concatenates multiple CSS files in manifest order', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  write(dir, 'a.css', '.a {}');
  write(dir, 'b.css', '.b {}');
  manifest(dir, {
    template: 'template.html',
    styles: ['a.css', 'b.css'],
    scripts: [],
    output: 'out.html',
  });

  withVersionEnv({}, () => build(join(dir, 'build.json')));

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(result.indexOf('.a {}') < result.indexOf('.b {}'), '.a {} must precede .b {}');
});

test('concatenates multiple JS files in manifest order', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  write(dir, 'a.js', 'const a = 1;');
  write(dir, 'b.js', 'const b = 2;');
  manifest(dir, {
    template: 'template.html',
    styles: [],
    scripts: ['a.js', 'b.js'],
    output: 'out.html',
  });

  withVersionEnv({}, () => build(join(dir, 'build.json')));

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(result.indexOf('const a') < result.indexOf('const b'), 'a must precede b');
});

test('creates the output directory when it does not exist', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  manifest(dir, {
    template: 'template.html',
    styles: [],
    scripts: [],
    output: 'deep/nested/out.html',
  });

  assert.doesNotThrow(() => withVersionEnv({}, () => build(join(dir, 'build.json'))));
  assert.ok(readFileSync(join(dir, 'deep', 'nested', 'out.html'), 'utf8').length > 0);
});

test('throws when the STYLES sentinel is absent from the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--SCRIPTS--><!--VERSION--></html>');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  assert.throws(
    () => build(join(dir, 'build.json')),
    /missing the required sentinel: <!--STYLES-->/,
  );
});

test('throws when the SCRIPTS sentinel is absent from the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--STYLES--><!--VERSION--></html>');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  assert.throws(
    () => build(join(dir, 'build.json')),
    /missing the required sentinel: <!--SCRIPTS-->/,
  );
});

test('throws when the VERSION sentinel is absent from the template', () => {
  const dir = tempDir();
  write(dir, 'template.html', '<html><!--STYLES--><!--SCRIPTS--></html>');
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  assert.throws(
    () => build(join(dir, 'build.json')),
    /missing the required sentinel: <!--VERSION-->/,
  );
});

test('VERSION sentinel: renders a linked tag and locale-formatting script when built from a tag', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  withVersionEnv(
    {
      GITHUB_REF_TYPE: 'tag',
      GITHUB_REF_NAME: 'v1.2.3',
      GITHUB_SHA: 'a'.repeat(40),
      KEEPASS_WEB_COMMIT_DATE: '2026-07-01T12:00:00Z',
    },
    () => build(join(dir, 'build.json')),
  );

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(
    result.includes(
      '<a href="https://github.com/keepass-web/source-application/tree/v1.2.3">v1.2.3</a>',
    ),
  );
  assert.ok(
    result.includes('committed on <time id="commit-date" datetime="2026-07-01T12:00:00Z">'),
  );
  assert.ok(result.includes("new Date(document.getElementById('commit-date')"));
});

test('VERSION sentinel: falls back to a linked short sha when there is no exact tag', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  const sha = `${'b'.repeat(39)}c`;
  withVersionEnv({ GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'main', GITHUB_SHA: sha }, () =>
    build(join(dir, 'build.json')),
  );

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(
    result.includes(
      `<a href="https://github.com/keepass-web/source-application/commit/${sha}">sha:${sha.slice(0, 12)}</a>`,
    ),
  );
  assert.ok(!result.includes('committed on'));
});

test('VERSION sentinel: renders an unlinked "development build" with no env vars set', () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  withVersionEnv({}, () => build(join(dir, 'build.json')));

  const result = readFileSync(join(dir, 'out.html'), 'utf8');
  assert.ok(result.includes('development build'));
  assert.ok(!result.includes('<a href'));
});

// ---------------------------------------------------------------------------
// CLI (index.ts)
// ---------------------------------------------------------------------------

test('CLI: exits 1 and prints usage when no manifest path is given', async () => {
  const { code, stderr } = await runCLI([]);
  assert.equal(code, 1);
  assert.ok(stderr.includes('Usage:'), `expected usage message, got: ${stderr}`);
});

test('CLI: exits 0 and prints sha256 checksum and output path on success', async () => {
  const dir = tempDir();
  write(dir, 'template.html', SENTINELS);
  manifest(dir, { template: 'template.html', styles: [], scripts: [], output: 'out.html' });

  const { code, stdout } = await runCLI([join(dir, 'build.json')]);
  assert.equal(code, 0);
  assert.ok(stdout.startsWith('sha256:'), `expected sha256: prefix, got: ${stdout}`);
  assert.match(stdout.trim(), /^sha256:[0-9a-f]{64} {2}.+out\.html$/);
});
