/**
 * Builds a small, real KDBX v4 database and writes it to a temp file, for
 * tests that need to drive a real file input — Puppeteer's uploadFile()
 * needs a path on disk, not raw bytes.
 */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendChild, Credentials, createEntry, Kdbx } from '../../packages/kdbx/src/index.ts';

// Same fast KDF settings the jsdom suite uses (see pages/tests/*.test.ts and
// packages/kdbx/tests) — this is a throwaway fixture, not a security-relevant
// artifact, so there's no reason for it to pay real Argon2id cost.
const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;

export interface KdbxFixture {
  path: string;
  password: string;
  entryTitle: string;
}

export async function writeKdbxFixture(): Promise<KdbxFixture> {
  const password = 'e2e-test-password';
  const entryTitle = 'Example Entry';

  const credentials = new Credentials({ password });
  const kdbx = await Kdbx.create(credentials, {
    version: 4,
    cipher: 'chacha20',
    kdf: 'argon2id',
    argon2: FAST_ARGON2,
    aesKdfRounds: 1000n,
    databaseName: 'E2E Fixture',
  });
  appendChild(
    kdbx.getRootGroup(),
    createEntry({ title: entryTitle, username: 'octocat', password: 'hunter2' }),
  );
  const bytes = await kdbx.save();

  const path = join(
    tmpdir(),
    `keepass-web-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.kdbx`,
  );
  await writeFile(path, bytes);

  return { path, password, entryTitle };
}
