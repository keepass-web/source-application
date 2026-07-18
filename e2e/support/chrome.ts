/**
 * Resolves a real Chrome/Chromium executable for puppeteer-core to drive.
 *
 * puppeteer-core (unlike plain puppeteer) bundles no browser of its own and
 * has no install-time download step — that's the whole reason it's the
 * package used here: AGENTS.md's dependency policy rejects any devDependency
 * whose install script reaches outside npm's pinned, hash-verified
 * resolution (enforced by tools/build/dependency-policy/check.js), and a
 * bundled-browser downloader is exactly that. Driving a browser that's
 * already on the machine sidesteps the question entirely.
 *
 * GitHub's ubuntu-latest runner ships Google Chrome at /usr/bin/google-chrome
 * (see actions/runner-images' Ubuntu 24.04 software manifest), so CI needs no
 * extra install step either. The macOS/Windows paths below cover common
 * local dev setups.
 */
import { existsSync } from 'node:fs';
import { platform } from 'node:os';

const KNOWN_PATHS: Record<string, string[]> = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
};

/**
 * Checks CHROME_PATH first, then a short list of known install locations for
 * the current platform. Throws rather than silently skipping if none is
 * found — an e2e run that can't find a browser should fail loudly, not
 * report a false pass.
 */
export function resolveChromePath(): string {
  const override = process.env.CHROME_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`CHROME_PATH is set to "${override}", but no file exists there.`);
    }
    return override;
  }

  const candidates = KNOWN_PATHS[platform()] ?? [];
  const found = candidates.find((path) => existsSync(path));
  if (!found) {
    throw new Error(
      `No Chrome/Chromium found for platform "${platform()}". Checked: ${
        candidates.join(', ') || '(no known paths for this platform)'
      }. Set CHROME_PATH to override.`,
    );
  }
  return found;
}
