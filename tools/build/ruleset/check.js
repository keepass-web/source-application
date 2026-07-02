// @ts-check
/**
 * Validates that the default branch has all required branch protection rules.
 *
 * Outcomes per required rule type:
 *   - Present and active   → pass (exit 0)
 *   - Present but disabled → warn (exit 0); re-enable when churn period ends
 *   - Absent entirely      → fail (exit 1)
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

/** @type {{ required_rule_types: string[] }} */
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

// Fetch rules that are currently active on the default branch.
// This endpoint returns only rules from active rulesets.
let activeRuleList;
try {
  const json = execSync(`gh api repos/${repo}/rules/branches/${defaultBranch}`, {
    encoding: 'utf8',
  });
  activeRuleList = /** @type {{ type: string }[]} */ (JSON.parse(json));
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
    /** @type {{ rules?: { type: string }[], conditions?: { ref_name?: { include?: string[] } } }} */
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

const activeTypes = new Set(activeRuleList.map((r) => r.type));

const missing = expected.required_rule_types.filter(
  (t) => !activeTypes.has(t) && !disabledRuleTypes.has(t),
);
const disabled = expected.required_rule_types.filter(
  (t) => !activeTypes.has(t) && disabledRuleTypes.has(t),
);
const active = expected.required_rule_types.filter((t) => activeTypes.has(t));

if (missing.length > 0) {
  process.stderr.write(
    `Branch '${defaultBranch}' is missing required rules entirely: ${missing.join(', ')}\n` +
      'Import ruleset/ruleset.json from keepass-web/build via Settings → Rules → Rulesets → Import and re-run CI.\n',
  );
  process.exit(1);
}

if (disabled.length > 0) {
  process.stdout.write(
    `Warning: required rules present but disabled on '${defaultBranch}': ${disabled.join(', ')}\n` +
      'Re-enable the ruleset in Settings → Rules → Rulesets when the high-churn period ends.\n',
  );
}

if (active.length > 0) {
  process.stdout.write(`Active on '${defaultBranch}': ${active.join(', ')}\n`);
}
