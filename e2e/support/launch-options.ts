/**
 * Puppeteer launch options that are useful to flip from the command line
 * while debugging a test, without editing the test file itself: HEADLESS=false
 * opens a real, visible browser window instead of running headless, and
 * SLOWMO=<ms> adds a delay between actions so what's happening is actually
 * visible rather than flashing by.
 *
 * Environment variables, not CLI flags, because these run through
 * `npm run test:e2e` at the repo root, which itself runs `npm run build &&
 * npm run test:e2e --workspace=e2e` — env vars inherit through every layer
 * of that chain for free; a flag passed to the outer `npm run` would need
 * explicit forwarding through each `npm run` in between, and Node's own
 * `--test` CLI would likely misparse an unrecognized flag placed after the
 * test file glob as another (non-matching) glob rather than an option.
 *
 * Same convention as CHROME_PATH in ./chrome.ts.
 */
export interface LaunchOptions {
  headless: boolean;
  slowMo: number;
}

/**
 * HEADLESS accepts "false"/"0"/"no" to mean visible; anything else (including
 * unset) means headless, which is the default. SLOWMO is milliseconds of
 * delay Puppeteer inserts between actions; unset or non-numeric means 0.
 */
export function resolveLaunchOptions(): LaunchOptions {
  const headlessEnv = (process.env.HEADLESS ?? '').trim().toLowerCase();
  const headless = !['false', '0', 'no'].includes(headlessEnv);

  const slowMoEnv = Number(process.env.SLOWMO);
  const slowMo = Number.isFinite(slowMoEnv) && slowMoEnv > 0 ? slowMoEnv : 0;

  return { headless, slowMo };
}
