/**
 * Turns the commit a build ran at into the small "vX.Y.Z" / "sha:<short>"
 * footer fragment shown on every distributable. Reads no environment itself
 * (see build.ts) so it stays a pure, directly testable function.
 *
 * The three ref inputs mirror GitHub Actions' own env vars (GITHUB_REF_TYPE,
 * GITHUB_REF_NAME, GITHUB_SHA) on purpose: every CI job already has them for
 * free, and REPRODUCING.md documents setting the same names by hand outside
 * CI, so there's exactly one interface rather than a bespoke one per context.
 */

const REPO_URL = 'https://github.com/keepass-web/source-application';
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const SHORT_SHA_LENGTH = 12;

export interface VersionRefEnv {
  readonly refType?: string | undefined;
  readonly refName?: string | undefined;
  readonly sha?: string | undefined;
}

export interface VersionLabel {
  readonly label: string;
  readonly url: string | null;
}

/**
 * Resolves what a build should call itself:
 * - an exact `vX.Y.Z` tag push -> the tag name, linking to that tree
 * - any other commit with a known sha -> `sha:<short>`, linking to that commit
 * - neither (a bare local `npm run build`) -> "development build", unlinked —
 *   never assert a provenance the build can't back up.
 */
export function computeVersionLabel(env: VersionRefEnv): VersionLabel {
  if (env.refType === 'tag' && env.refName !== undefined && TAG_PATTERN.test(env.refName)) {
    return { label: env.refName, url: `${REPO_URL}/tree/${env.refName}` };
  }

  if (env.sha !== undefined && env.sha !== '') {
    const short = env.sha.slice(0, SHORT_SHA_LENGTH);
    return { label: `sha:${short}`, url: `${REPO_URL}/commit/${env.sha}` };
  }

  return { label: 'development build', url: null };
}

/**
 * Renders the <!--VERSION--> replacement: the label (linked, if we have a
 * URL) and, when a commit date is known, "committed on <time>" plus a tiny
 * inline script that reformats that <time> into the visitor's own locale.
 * The build only knows the commit's ISO instant — locale is a property of
 * whoever is looking at the page, not of the build, so it can only be
 * resolved client-side.
 */
export function renderVersionFragment(version: VersionLabel, commitDateIso?: string): string {
  const labelHtml = version.url ? `<a href="${version.url}">${version.label}</a>` : version.label;

  if (commitDateIso === undefined || commitDateIso === '') {
    return labelHtml;
  }

  return (
    `${labelHtml} committed on <time id="commit-date" datetime="${commitDateIso}">${commitDateIso}</time>` +
    '<script>' +
    "document.getElementById('commit-date').textContent = " +
    "new Date(document.getElementById('commit-date').getAttribute('datetime')).toLocaleString();" +
    '</script>'
  );
}
