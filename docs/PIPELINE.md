# Pipeline

This document maps the complete build, release, and deploy pipeline.

## Workflow inventory

| Workflow | Location | Description |
|---|---|---|
| CI pipeline | [`source-application/.github/workflows/ci.yml`][ci-workflow] | Lints, type-checks, tests, and builds on every push and pull request in `source-application`. |
| Release | [`source-application/.github/workflows/release.yml`][release-workflow] | Builds, attests, and publishes a GitHub release on every version tag in `source-application`, then triggers deploy. |
| Deploy | [`keepass-web.app/.github/workflows/deploy.yml`][deploy-workflow] | Verifies release attestations and opens a PR in `keepass-web.app` to publish the release to `gh-pages` branch. |
| Deploy verification | [`keepass-web.app/.github/workflows/ci.yml`][deploy-ci] | Verifies distributables on every `keepass-web.app` PR targeting `gh-pages`. |

The crypto libraries, the KDBX parser, the app, and the build tooling are all in this repo, so there's one CI configuration to write and run.

### Why the deploy workflow doesn't live here

The deploy workflow downloads release assets, verifies them, and pushes to a specific GitHub Pages repo's `gh-pages` branch. It has to live in that repo because that's where the Pages configuration, the `gh-pages` branch protection, and the deploy-bot's scoped permissions all are. To audit the complete pipeline, a reader needs this repo and `keepass-web.app`. This document links each.

## Architecture

Who does what, and which workflow it triggers:

```mermaid
sequenceDiagram
    actor Contributor as KeePass Web contributor
    participant SACI as source-application<br/>CI pipeline
    participant SAREL as source-application<br/>Release
    actor Bot as keepass-web-deploy-bot<br/>(GitHub App)
    participant DEPLOY as keepass-web.app<br/>Deploy
    participant DCI as keepass-web.app<br/>Deploy verification
    actor Reviewer as KeePass Web reviewer

    Contributor->>SACI: Open pull request
    activate SACI
    SACI->>SACI: Ruleset check, lint, typecheck, test, build
    deactivate SACI

    Contributor->>SACI: Merge pull request (push to main)
    activate SACI
    SACI->>SACI: Ruleset check, lint, typecheck, test, build
    deactivate SACI

    Contributor->>SAREL: Push version tag vX.Y.Z
    activate SAREL
    SAREL->>SAREL: Lint, typecheck, test, verify tag,<br/>build, attest, create release
    SAREL->>Bot: Request short-lived token<br/>scoped to keepass-web.app
    Bot-->>SAREL: Token
    SAREL->>DEPLOY: Trigger via workflow_dispatch
    deactivate SAREL

    activate DEPLOY
    DEPLOY->>Bot: Request app token
    Bot-->>DEPLOY: Token
    DEPLOY->>DEPLOY: Download release assets (public, no token)
    DEPLOY->>DEPLOY: Verify attestations against source-application
    DEPLOY->>DEPLOY: Push deploy/vX.Y.Z branch
    DEPLOY->>Bot: Open PR against gh-pages, using the app token
    deactivate DEPLOY

    DEPLOY->>DCI: Opening the PR triggers pull_request (branch: gh-pages)
    activate DCI
    DCI->>DCI: Verify distributables
    deactivate DCI

    Reviewer->>DEPLOY: Review, squash-merge PR
    DEPLOY->>DEPLOY: GitHub Pages publishes gh-pages
```

A version-tag push is a separate, deliberate action from merging a regular pull request — merging only re-runs CI on `main`; nothing deploys until someone pushes a tag.

## CI pipeline

Runs on every push and pull request.

```mermaid
flowchart TD
    E["Push or pull request"]
    E --> RULE["Ruleset check\nValidates branch protection rules\nagainst the required configuration.\nFails immediately if not met."]
    RULE -->|fail| STOP(["Pipeline blocked"])
    RULE -->|pass| LINT["Biome lint and format"]
    LINT --> TC["tsc --noEmit type check, every workspace"]
    TC --> TEST["node:test suite, every workspace"]
    TEST --> BUILD["npm run build\nargon2 + chacha20 -> kdbx -> pages\nbundle + inline x 3 pages"]
    BUILD --> SUM["Publish checksums\nto step summary"]
```

## Release pipeline

Runs when a `v*` tag is pushed. Defined entirely in `.github/workflows/release.yml`.

```mermaid
flowchart TD
    TAG["git push --follow-tags"]
    TAG --> AREL["release.yml"]
    AREL --> CI3["Lint · type check · test"]
    CI3 --> VER2["Verify tag = package.json version"]
    VER2 --> BUILD["Copy CNAME; run the inliner\nfor each page (deps.js is committed\nsource, kept fresh by CI's build step)\nOutputs: 0x67.html\nrouter.html\nindex.html · CNAME"]
    BUILD --> ATTEST["Attest all four files\nactions/attest-build-provenance\nSigns to Sigstore transparency log"]
    ATTEST --> GHREL["Create GitHub release\nUpload all four files\nPublish checksums in release notes"]
    GHREL --> TOKEN["Generate short-lived App token\nscoped to the deploy repo"]
    TOKEN --> TRIG["Trigger deploy workflow\nvia workflow_dispatch"]
    TRIG --> DEPLOY(["Deploy pipeline begins"])
```

## Deploy pipeline

Runs automatically after a release, or manually via Actions → Deploy → Run workflow. Defined entirely in `keepass-web.app/.github/workflows/deploy.yml`.

Every file committed to `gh-pages` is a verbatim copy of a release artifact. Nothing is created or modified during deployment.

```mermaid
flowchart TD
    TRIG["Triggered by release\nor manual dispatch"]
    TRIG --> CKO2["Checkout gh-pages branch"]
    CKO2 --> DL["Download all four release assets\nfrom public GitHub release URL\nNo token required"]
    DL --> V1["gh attestation verify 0x67.html"]
    V1 --> V2["gh attestation verify router.html"]
    V2 --> V3["gh attestation verify index.html"]
    V3 --> V4["gh attestation verify CNAME"]
    V4 --> OK{"All verified against\nkeepass-web/source-application?"}
    OK -->|no| FAIL(["Fail — workflow stops\nNothing is deployed"])
    OK -->|yes| PUSH["Push deploy/vX.Y.Z branch\ngit add all four files\nNo other files touched"]
    PUSH --> PR["Open PR against gh-pages\nvia GitHub App token"]
    PR --> HUMAN["Human review"]
    HUMAN --> MERGE["Squash merge\n(only merge strategy permitted)"]
    MERGE --> PAGES(["GitHub Pages updated\nkeepass-web.app serves new release"])
```

### Deploy PR verification

Every PR targeting `gh-pages` runs `keepass-web.app/ci.yml`, which verifies the distributables before the PR can be merged. Checksum verification against the published release is [not yet implemented][deploy-ci]. For how the resulting artifacts are verified end to end, see [Verifying a release independently][releases-verify].

[ci-workflow]: https://github.com/keepass-web/source-application/blob/main/.github/workflows/ci.yml
[release-workflow]: https://github.com/keepass-web/source-application/blob/main/.github/workflows/release.yml
[deploy-workflow]: https://github.com/keepass-web/keepass-web.app/blob/main/.github/workflows/deploy.yml
[deploy-ci]: https://github.com/keepass-web/keepass-web.app/blob/main/.github/workflows/ci.yml
[releases-verify]: RELEASES.md#verifying-a-release-independently
