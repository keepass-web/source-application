# Branch Protection Rulesets

Every keepass-web repository must have branch protection rules active on its default branch. CI validates this on every run via `tools/build/ruleset/check.js`. The required rules are defined in `tools/build/ruleset/expected.json`.

## Required rules

| Rule type | Effect |
|---|---|
| `deletion` | Prevents the default branch from being deleted |
| `non_fast_forward` | Prevents force pushes to the default branch |
| `pull_request` | Requires a pull request before merging; no direct pushes |
| `required_signatures` | Requires all commits to be signed |
| `required_status_checks` | Requires the CI pipeline job to pass before merging |

## Setting up a new repository

Rules are created once when a new repository is created by importing `tools/build/ruleset/ruleset.json` from this repo. CI validates them continuously thereafter.

1. In the new repository, go to **Settings → Rules → Rulesets**.
2. Click **New ruleset → Import a ruleset**.
3. Upload `tools/build/ruleset/ruleset.json` from this repo.
4. Confirm the name, enforcement status (Active), and target branch, then click **Create**.

Once created, CI will validate the ruleset on every push and pull request. If the ruleset is removed or downgraded to a non-active state, CI fails immediately.

## How validation works

The `ruleset` CI job calls `tools/build/ruleset/check.js`, which:

1. Fetches the default branch name via the GitHub API.
2. Calls the "rules for a branch" endpoint, which returns the merged set of all active rules applying to that branch.
3. Calls the rulesets endpoint to find any disabled rulesets that apply to the default branch, and collects their rule types.
4. For each required rule type:
   - **Active** — present in an active ruleset → pass
   - **Disabled** — present only in a disabled ruleset → CI fails immediately
   - **Absent** — not in any ruleset → CI fails immediately
5. Fails with a clear message listing any absent and any disabled rules.

The check runs before the rest of the pipeline and blocks it on failure.

Rulesets must remain active at all times, including during high-churn periods (e.g. initial development). Disabling a ruleset — even temporarily — fails CI immediately; re-enable it in Settings → Rules → Rulesets to unblock the pipeline.
