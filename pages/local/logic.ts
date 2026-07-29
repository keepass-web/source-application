/**
 * Pure logic for the local-file chooser: just the must()-style "fail loudly
 * on a missing DOM node" guard page.ts needs. Format detection lives in
 * packages/router (shared with every chooser), and the embed protocol lives
 * in packages/embed-protocol (shared with every host and with 0x67) — this
 * page has no pure logic of its own beyond the DOM-lookup guard, which is
 * kept here rather than in page.ts for the same reason every other
 * connector's is: so its throw branch is exercisable directly from a logic
 * test.
 *
 * This is a real ES module, exactly like router's and cloud-google-drive's
 * logic.ts. For the browser build, bundle-iife strips the `export` keyword
 * below and hoists this name onto globalThis — see local/bundle-iife.json.
 * page.ts consumes it as a global, not via import — see globals.d.ts.
 */

export function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected element not found');
  }
  return value;
}
