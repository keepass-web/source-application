# Reproducing a Build

Any party can reproduce a versioned distributable and verify it against the published checksum. The steps are:

1. Check out the exact tagged commit:

   ```sh
   git clone https://github.com/keepass-web/source-application
   cd source-application
   git checkout v<version>
   ```

2. Build the pinned container image from `tools/build/Dockerfile` at the same commit. The build context is the repo root (the Dockerfile expects the root `package.json`/`package-lock.json`, which hold every pinned build-time dependency for the whole workspace):

   ```sh
   docker build -t keepass-web-build -f tools/build/Dockerfile .
   ```

3. Run the build inside the container:

   ```sh
   docker run --rm -v "$PWD":/workspace keepass-web-build \
     sh -c "npm ci && npm run build"
   ```

   `npm run build` builds `argon2`, `chacha20`, and `kdbx`, then bundles and inlines each page. The inliner prints `sha256:<hex>  <output path>` to stdout once per distributable (`index.html`, `router.html`, `0x67.html`), so each checksum is unambiguously tied to the file it belongs to.

4. Compare each printed checksum against the corresponding value published with the release.

Two independent builds of the same source commit must produce an identical checksum. A mismatch means the build is not reproducible and should be treated as suspect.

## Verifying pinned dependencies

All build-time dependencies are pinned with enforced integrity checks:

- **npm packages** (`typescript`, `@biomejs/biome`): exact versions in `package.json`; sha512 integrity hashes in `package-lock.json`. `npm ci` verifies every hash before installation.

- **Base container image**: pinned by digest in `Dockerfile`. Tags are mutable; the digest is not. Docker verifies the digest at pull time.

To verify any npm package hash independently against the registry:

```sh
npm view <package>@<version> dist.integrity
```

To verify the base image digest independently:

```sh
docker buildx imagetools inspect node:22.23.0-slim --format '{{.Manifest.Digest}}'
```

## Updating a dependency

Dependency updates require source-level review — the same rigour as source code changes.

**npm package update:**

1. Update the version in `package.json`.
2. Regenerate `package-lock.json`: `npm install --package-lock-only`.
3. Verify the new integrity hash against the registry: `npm view <package>@<version> dist.integrity`.
4. Open a pull request. Review the diff to `package-lock.json` with the same care as a source change.

**Base image update:**

1. Update the `FROM` line in `Dockerfile` with the new version tag and its digest.
2. Verify the digest: `docker buildx imagetools inspect node:<version>-slim --format '{{.Manifest.Digest}}'`.
3. Open a pull request.

No dependency update is merged without a verified, reviewed change to the relevant pinning file (`package-lock.json` or `Dockerfile`).
