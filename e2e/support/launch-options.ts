/** HEADLESS=false / SLOWMO=<ms>, read from the environment (not CLI flags)
 * so they survive the `npm run test:e2e` → `--workspace=e2e` script chain
 * without needing explicit forwarding — same convention as CHROME_PATH. */
export interface LaunchOptions {
  headless: boolean;
  slowMo: number;
}

export function resolveLaunchOptions(): LaunchOptions {
  const headlessEnv = (process.env.HEADLESS ?? '').trim().toLowerCase();
  const headless = !['false', '0', 'no'].includes(headlessEnv);

  const slowMoEnv = Number(process.env.SLOWMO);
  const slowMo = Number.isFinite(slowMoEnv) && slowMoEnv > 0 ? slowMoEnv : 0;

  return { headless, slowMo };
}
