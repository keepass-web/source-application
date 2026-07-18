/** Finds a Chrome/Chromium already on the machine — puppeteer-core bundles
 * none, on purpose, to avoid the install-time download AGENTS.md's
 * dependency policy rejects. ubuntu-latest ships Chrome at the linux path
 * below, so CI needs no extra setup either. */
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

/** Throws rather than skipping if nothing is found — a false pass would be
 * worse than a loud failure. */
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
