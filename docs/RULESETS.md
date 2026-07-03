# Branch Protection Rulesets

Every keepass-web repository must have branch protection rules active on its default branch, configured at least as strictly as required. CI validates this on every run via `tools/build/ruleset/check.js`. The required rules — and, where it matters, their required parameters — are defined in `tools/build/ruleset/expected.json`.

## Required rules

| Rule type | Effect |
|---|---|
| `deletion` | Prevents the default branch from being deleted |
| `non_fast_forward` | Prevents force pushes to the default branch |
| `pull_request` | Requires a pull request before merging; no direct pushes |
| `required_signatures` | Requires all commits to be signed |
| `code_scanning` | Blocks merging on any CodeQL alert |
| `required_status_checks` | Requires the CI pipeline job to pass before merging |

## Repository setup

Rules are created by importing `tools/build/ruleset/ruleset.json` from this repo. CI validates them continuously thereafter.

1. In the repository, go to **Settings → Rules → Rulesets**.
2. If the intent is to edit the existing ruleset, delete it first then move to the next step.
2. Click **New ruleset → Import a ruleset**.
3. Upload `tools/build/ruleset/ruleset.json` from this repo.
4. Confirm the name, enforcement status (Active), and target branch, then click **Create**.

Once created, CI will validate the ruleset on every push to main and pull request into main. If the ruleset is removed or downgraded to a non-active state, CI fails immediately.

## How validation works

The `ruleset` CI job calls `tools/build/ruleset/check.js`, which:

1. Fetches the default branch name via the GitHub API.
2. Calls the "rules for a branch" endpoint, which returns the merged set of all active rules applying to that branch, each with its `type` and `parameters`.
3. Calls the rulesets endpoint to find any disabled rulesets that apply to the default branch, and collects their rule types.
4. For each required rule in `expected.json`:
   - **Active, parameters satisfied** — an active rule of that type exists, and if the required entry has a `parameters` object, at least one active rule of that type meets or exceeds it → pass
   - **Misconfigured** — an active rule of that type exists but none of them satisfy the required `parameters` → CI fails immediately
   - **Disabled** — present only in a disabled ruleset → CI fails immediately
   - **Absent** — not in any ruleset → CI fails immediately
5. Fails with a clear message listing any absent, disabled, or misconfigured rules.

"Satisfies" means every key required in `parameters` has a matching value in the live rule (arrays are matched element-by-element the same way); fields the API returns that aren't listed in `expected.json` are ignored, so a rule configured more strictly than required still passes.

The check runs before the rest of the pipeline and blocks it on failure.

Rulesets must remain active at all times, including during high-churn periods (e.g. initial development). Disabling a ruleset — even temporarily — fails CI immediately; re-enable it in Settings → Rules → Rulesets to unblock the pipeline.
