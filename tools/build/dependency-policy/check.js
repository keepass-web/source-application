// @ts-check
/**
 * Enforces the project's dependency policy (see AGENTS.md and
 * docs/REPRODUCING.md): no devDependency, direct or transitive, may run an
 * install-time script that reaches outside npm's own pinned, hash-verified
 * resolution.
 *
 * `npm ci` verifies every package's sha512 integrity hash from
 * package-lock.json before installation, but that guarantee only covers
 * bytes npm itself fetched from the registry. A postinstall or preinstall
 * script that downloads a platform binary from a CDN or a GitHub release
 * afterward is invisible to that check and isn't pinned or hashed anywhere —
 * exactly the "supply chain gymnastics" this check exists to catch.
 *
 * npm's lockfile marks every package with an install/preinstall/postinstall
 * script `hasInstallScript: true`. Any such package (other than the
 * project's own root entry, key `''`, which is source code, not a
 * dependency) fails this check.
 *
 * There is no allow-list here, on purpose: a dependency that needs one to
 * pass is rejected, not exempted. If that changes, it changes here, later,
 * deliberately — not by adding a bypass now.
 *
 * Usage: node check.js [path/to/package-lock.json]
 * Defaults to the repo root's package-lock.json when no path is given.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const defaultLockfilePath = resolve(dir, '../../../package-lock.json');

/** @typedef {{ version?: string, hasInstallScript?: boolean }} LockfilePackage */
/** @typedef {{ packages: Record<string, LockfilePackage> }} Lockfile */

/**
 * Reads the lockfile at `lockfilePath` and returns the key and version of
 * every non-root package with an install script.
 *
 * @param {string} lockfilePath
 * @returns {{ name: string, version: string | undefined }[]}
 */
function findInstallScripts(lockfilePath) {
  /** @type {Lockfile} */
  const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
  const offenders = [];
  for (const [key, pkg] of Object.entries(lockfile.packages)) {
    if (key === '') continue; // the project's own package.json, not a dependency
    if (pkg.hasInstallScript) {
      offenders.push({ name: key, version: pkg.version });
    }
  }
  return offenders;
}

const [, , lockfilePathArg] = process.argv;
const offenders = findInstallScripts(lockfilePathArg ?? defaultLockfilePath);

if (offenders.length > 0) {
  process.stderr.write(
    'Dependency policy violation: the following packages run an install-time script, ' +
      "which means part of what they install isn't covered by npm ci's integrity check:\n\n" +
      offenders.map((o) => `  - ${o.name} (${o.version})\n`).join('') +
      '\nThis is rejected, not allow-listed — see AGENTS.md and docs/REPRODUCING.md.\n',
  );
  process.exit(1);
}

process.stdout.write('Dependency policy check passed: no install scripts found.\n');
