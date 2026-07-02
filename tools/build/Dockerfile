# syntax=docker/dockerfile:1
#
# keepass-web build environment
#
# A pinned, independently-reproducible environment for verifying a release —
# see docs/REPRODUCING.md. CI itself does not use this image; it runs directly
# on the GitHub Actions runner via actions/setup-node. All tools here are
# installed at exact versions; npm ci verifies every package's sha512
# integrity hash from package-lock.json before any build step runs.
#
# Build context is the repo root (see docs/REPRODUCING.md), so the COPY below
# picks up the root package.json/package-lock.json — the whole workspace's
# pinned devDependencies (typescript, @biomejs/biome), not a subset.
#
# Base image: node:22.23.0-slim (Debian bookworm-slim, multi-arch)
# Digest covers amd64 and arm64. Verify with:
#   docker manifest inspect node:22.23.0-slim
FROM node:22.23.0-slim@sha256:d9f850096136edbc402debdd8729579a288aac64574ada0ff4db26b6ae58b0b2

# Tools are installed into /tools. Binaries are placed on PATH.
# npm ci verifies every package's sha512 integrity hash from package-lock.json.
WORKDIR /tools
COPY package.json package-lock.json ./
RUN npm ci

ENV PATH="/tools/node_modules/.bin:$PATH"

WORKDIR /workspace
