# Pipeline

This document maps the complete build, release, and deploy pipeline. Almost
all of it lives in this repo; the one exception — the deploy step — lives in
a separate repo because it's what owns the GitHub Pages configuration being
deployed to.

---

## Workflow inventory

| Workflow | Location | Type |
|---|---|---|
| CI pipeline | `.github/workflows/ci.yml` | Substantive |
| Release | `.github/workflows/release.yml` | Substantive |
| Deploy | `keepass-web.app/.github/workflows/deploy.yml` | Substantive — separate repo |
| Deploy verification | `keepass-web.app/.github/workflows/ci.yml` | Substantive — separate repo |

The crypto libraries, the KDBX parser, the app, and the build tooling are all
in this repo, so there's one CI configuration to write and run.

### Why the deploy workflow doesn't live here

The deploy workflow downloads release assets, verifies them, and pushes to a
specific GitHub Pages repo's `gh-pages` branch. It has to live in that repo
because that's where the Pages configuration, the `gh-pages` branch
protection, and the deploy-bot's scoped permissions all are. To audit the
complete pipeline, a reader needs this repo and `keepass-web.app`. This
document links each.

---

## Architecture

```mermaid
flowchart TD
    subgraph app["keepass-web/source-application — this repo"]
        ACI["ci.yml"]
        AREL["release.yml"]
    end

    subgraph pages["keepass-web/keepass-web.app"]
        DCI["ci.yml"]
        DEPLOY["deploy.yml"]
    end

    AREL -->|triggers| DEPLOY
    AREL -->|produces assets verified by| DCI
```

---

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

---

## Release pipeline

Runs when a `v*` tag is pushed. Defined entirely in
`.github/workflows/release.yml`.

```mermaid
flowchart TD
    TAG["git push --follow-tags"]
    TAG --> AREL["release.yml"]
    AREL --> CI3["Lint · type check · test"]
    CI3 --> VER2["Verify tag = package.json version"]
    VER2 --> BUILD["Copy CNAME; run the inliner\nfor each page (deps.js is committed\nsource, kept fresh by CI's build step)\nOutputs: keepass-web-0x67.html\nkeepass-web-router.html\nindex.html · CNAME"]
    BUILD --> ATTEST["Attest all four files\nactions/attest-build-provenance\nSigns to Sigstore transparency log"]
    ATTEST --> GHREL["Create GitHub release\nUpload all four files\nPublish checksums in release notes"]
    GHREL --> TOKEN["Generate short-lived App token\nscoped to the deploy repo"]
    TOKEN --> TRIG["Trigger deploy workflow\nvia workflow_dispatch"]
    TRIG --> DEPLOY(["Deploy pipeline begins"])
```

---

## Deploy pipeline

Runs automatically after a release, or manually via Actions → Deploy →
Run workflow. Defined entirely in
`keepass-web.app/.github/workflows/deploy.yml`.

Every file committed to `gh-pages` is a verbatim copy of a release artifact.
Nothing is created or modified during deployment.

```mermaid
flowchart TD
    TRIG["Triggered by release\nor manual dispatch"]
    TRIG --> CKO2["Checkout gh-pages branch"]
    CKO2 --> DL["Download all four release assets\nfrom public GitHub release URL\nNo token required"]
    DL --> V1["gh attestation verify keepass-web-0x67.html"]
    V1 --> V2["gh attestation verify keepass-web-router.html"]
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

Every PR targeting `gh-pages` runs `keepass-web.app/ci.yml`, which
verifies the distributables before the PR can be merged. Checksum verification
against the published release is [not yet implemented][deploy-ci].

---

## Attestation and the trust chain

```mermaid
flowchart LR
    SRC["Source code\naudit here"]
    SRC --> BUILD2["Release workflow\nbuilds distributables"]
    BUILD2 --> SIG["Sigstore\ntransparency log\nattestation signed"]
    SIG --> REL["GitHub release\nartifacts + checksums"]
    REL --> VER3["Deploy workflow\ngh attestation verify"]
    VER3 --> SITE["keepass-web.app\nidentical files"]
    REL --> LOCAL["Local download\nidentical files"]

    SITE -. "same bytes" .- LOCAL
```

A file on keepass-web.app and a file downloaded from the GitHub release are the
same bytes. Trust established by auditing the source and verifying the
attestation transfers to both without qualification.

[deploy-ci]: https://github.com/keepass-web/keepass-web.app/blob/main/.github/workflows/ci.yml
