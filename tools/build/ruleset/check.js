// @ts-check
/**
 * Validates that the default branch has all required branch protection rules,
 * each configured with at least the required parameters (where specified).
 *
 * Outcomes per required rule:
 *   - Present, active, parameters satisfied → pass (exit 0)
 *   - Present but disabled                  → fail (exit 1)
 *   - Present and active but parameters
 *     don't meet the requirement            → fail (exit 1)
 *   - Absent entirely                       → fail (exit 1)
 *
 * "Parameters satisfied" means every key required in expected.json is present
 * with a matching value in the live rule's parameters (see `satisfies`
 * below). A rule configured more strictly than required still passes; extra
 * fields the API returns that we don't require are ignored.
 *
 * Requires: gh CLI authenticated via GITHUB_TOKEN with contents:read (the
 * default for Actions). All three API endpoints used here require only
 * "Metadata" repository permissions (read), which the GITHUB_TOKEN provides
 * implicitly as its baseline permission.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

/** @typedef {{ type: string, parameters?: Record<string, unknown> }} RequiredRule */
/** @typedef {{ type: string, parameters?: Record<string, unknown> }} ApiRule */

/** @type {{ required_rules: RequiredRule[] }} */
const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

const repo = process.env.GITHUB_REPOSITORY;
if (!repo) {
  process.stderr.write('GITHUB_REPOSITORY is not set.\n');
  process.exit(1);
}

// Fetch the default branch name.
let defaultBranch;
try {
  defaultBranch = execSync(`gh api repos/${repo} --jq '.default_branch'`, {
    encoding: 'utf8',
  }).trim();
} catch (err) {
  process.stderr.write(
    `Failed to fetch repository metadata: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

// Fetch rules that are currently active on the default branch, including
// their parameters. This endpoint returns only rules from active rulesets.
let activeRuleList;
try {
  const json = execSync(`gh api repos/${repo}/rules/branches/${defaultBranch}`, {
    encoding: 'utf8',
  });
  activeRuleList = /** @type {ApiRule[]} */ (JSON.parse(json));
} catch (err) {
  process.stderr.write(
    `Failed to fetch active rules for ${repo}/${defaultBranch}: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

// Fetch all rulesets to find disabled ones that apply to the default branch.
let rulesets;
try {
  const json = execSync(`gh api repos/${repo}/rulesets`, { encoding: 'utf8' });
  rulesets = /** @type {{ id: number, enforcement: string }[]} */ (JSON.parse(json));
} catch (err) {
  process.stderr.write(
    `Failed to fetch rulesets for ${repo}: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}

/** @type {Set<string>} */
const disabledRuleTypes = new Set();

for (const ruleset of rulesets) {
  if (ruleset.enforcement !== 'disabled') continue;
  try {
    const json = execSync(`gh api repos/${repo}/rulesets/${ruleset.id}`, { encoding: 'utf8' });
    /** @type {{ rules?: ApiRule[], conditions?: { ref_name?: { include?: string[] } } }} */
    const detail = JSON.parse(json);

    // Only consider rulesets that target the default branch.
    const includes = detail.conditions?.ref_name?.include ?? [];
    const appliesToDefault =
      includes.includes('~DEFAULT_BRANCH') || includes.includes(`refs/heads/${defaultBranch}`);
    if (!appliesToDefault) continue;

    for (const rule of detail.rules ?? []) {
      disabledRuleTypes.add(rule.type);
    }
  } catch (err) {
    process.stderr.write(
      `Failed to fetch ruleset ${ruleset.id}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

/** @type {Map<string, ApiRule[]>} */
const activeRulesByType = new Map();
for (const rule of activeRuleList) {
  const list = activeRulesByType.get(rule.type) ?? [];
  list.push(rule);
  activeRulesByType.set(rule.type, list);
}

/**
 * Checks whether `actual` satisfies `expected`. Every key present in
 * `expected` must have a matching counterpart in `actual`; for arrays, every
 * element of `expected` must have some matching element in `actual`. Extra
 * keys/elements that only appear in `actual` are ignored, so a rule
 * configured more strictly than required still passes.
 * @param {unknown} expectedValue
 * @param {unknown} actualValue
 * @returns {boolean}
 */
function satisfies(expectedValue, actualValue) {
  if (Array.isArray(expectedValue)) {
    return (
      Array.isArray(actualValue) &&
      expectedValue.every((item) => actualValue.some((candidate) => satisfies(item, candidate)))
    );
  }
  if (expectedValue !== null && typeof expectedValue === 'object') {
    if (actualValue === null || typeof actualValue !== 'object') return false;
    return Object.entries(expectedValue).every(([key, value]) =>
      satisfies(value, /** @type {Record<string, unknown>} */ (actualValue)[key]),
    );
  }
  return expectedValue === actualValue;
}

/** @type {string[]} */
const missing = [];
/** @type {string[]} */
const disabled = [];
/** @type {string[]} */
const misconfigured = [];
/** @type {string[]} */
const active = [];

for (const rule of expected.required_rules) {
  const activeRules = activeRulesByType.get(rule.type);

  if (!activeRules || activeRules.length === 0) {
    if (disabledRuleTypes.has(rule.type)) {
      disabled.push(rule.type);
    } else {
      missing.push(rule.type);
    }
    continue;
  }

  if (rule.parameters && !activeRules.some((r) => satisfies(rule.parameters, r.parameters ?? {}))) {
    misconfigured.push(rule.type);
    continue;
  }

  active.push(rule.type);
}

if (missing.length > 0) {
  process.stderr.write(
    `Branch '${defaultBranch}' is missing required rules entirely: ${missing.join(', ')}\n` +
      'Import tools/build/ruleset/ruleset.json via Settings → Rules → Rulesets → Import and re-run CI.\n',
  );
}

if (disabled.length > 0) {
  process.stderr.write(
    `Branch '${defaultBranch}' has required rules present but disabled: ${disabled.join(', ')}\n` +
      'Re-enable the ruleset in Settings → Rules → Rulesets and re-run CI.\n',
  );
}

if (misconfigured.length > 0) {
  process.stderr.write(
    `Branch '${defaultBranch}' has required rules present but not configured strictly enough: ${misconfigured.join(', ')}\n` +
      'Compare the ruleset in Settings → Rules → Rulesets against tools/build/ruleset/ruleset.json, ' +
      'update it to match, and re-run CI.\n',
  );
}

if (missing.length > 0 || disabled.length > 0 || misconfigured.length > 0) {
  process.exit(1);
}

if (active.length > 0) {
  process.stdout.write(`Active on '${defaultBranch}': ${active.join(', ')}\n`);
}
