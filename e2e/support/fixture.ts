/** Writes a real KDBX v4 file to disk — Puppeteer's uploadFile() needs a
 * real path, not raw bytes. */
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendChild,
  Credentials,
  createEntry,
  createGroup,
  Kdbx,
} from '../../packages/kdbx/src/index.ts';

// Fast KDF settings (matches pages/tests/*.test.ts) — a throwaway fixture,
// no reason to pay real Argon2id cost.
const FAST_ARGON2 = { memoryBytes: 64n * 1024n, iterations: 1n, parallelism: 1 } as const;

export interface KdbxFixture {
  path: string;
  password: string;
  entryTitle: string;
  groupName: string;
}

export async function writeKdbxFixture(): Promise<KdbxFixture> {
  const password = 'e2e-test-password';
  const entryTitle = 'Example Entry';
  // Exactly 25 characters, the floor issue #63 sets for the group rail.
  const groupName = 'Financial Institutions XY';

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
  appendChild(kdbx.getRootGroup(), createGroup(groupName));
  const bytes = await kdbx.save();

  const path = join(
    tmpdir(),
    `keepass-web-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}.kdbx`,
  );
  await writeFile(path, bytes);

  return { path, password, entryTitle, groupName };
}
