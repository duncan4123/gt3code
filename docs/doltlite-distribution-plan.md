# Doltlite Distribution Plan

This plan covers what is needed to make `context-mode-doltlite` install cleanly
for users beyond the current `linux-x64` prebuild path.

## Current State

- Shipped prebuilds:
  - `prebuilds/linux-x64/node.abi127.node`
  - `prebuilds/linux-x64/node.abi137.node`
- Shipped Doltlite version:
  - `prebuilds/VERSION` = `v0.6.1`
- Current startup path:
  - `start.mjs` installs a matching prebuild when one exists
  - if no matching prebuild exists, `postinstall.mjs` falls back to `patch-doltlite.mjs`
- Current fallback risk:
  - `patch-doltlite.mjs` defaults to `/data/projects/doltlite`
  - that is valid for local development, not for general users

## Goal

Make installs deterministic for supported users and explicit for unsupported
ones:

1. supported platform + supported ABI → works out of the box
2. unsupported platform or ABI → fails with a clear, actionable message
3. local development → still supports rebuilding against a local doltlite checkout

## Work Items

### 1. Define Supported Platform / ABI Matrix

Decide the official support set and document it in the README and install docs.

Recommended first matrix:

- `linux-x64` ABI `127`
- `linux-x64` ABI `137`
- `darwin-arm64` current supported ABI(s)
- `darwin-x64` current supported ABI(s)

Optional second wave:

- `linux-arm64`
- `win32-x64`

Exit criteria:

- README names supported platform/ABI pairs
- install failures explicitly point users at the support matrix

### 2. Build and Ship Prebuilds for Supported Targets

For each supported platform/ABI pair:

- build Doltlite-linked `better_sqlite3.node`
- place artifact under `prebuilds/<platform>-<arch>/node.abi<N>.node`
- verify `SELECT doltlite_engine()` returns `prolly`
- smoke test `start.mjs` using that ABI

Exit criteria:

- supported users do not hit `patch-doltlite.mjs` in normal installs

### 3. Make Fallback Explicit for Non-Prebuild Installs

Change `patch-doltlite.mjs` and `postinstall.mjs` so published installs do not
assume `/data/projects/doltlite` exists.

Recommended behavior:

- if `DOLTLITE_BUILD_DIR` is set, use it
- otherwise, if no matching prebuild exists:
  - fail with a clear message
  - print supported platforms/ABIs
  - explain the developer rebuild path

Keep the `/data/projects/doltlite` default only for local repo development, or
remove it entirely in favor of explicit configuration.

Exit criteria:

- no hidden dependency on local workstation paths for end users

### 4. Add CI Validation for Packaging

Add packaging checks that run on every release candidate:

- `npm run typecheck`
- `npm run build`
- `npm pack --dry-run`
- assert packaged tarball includes:
  - `server.bundle.mjs`
  - `cli.bundle.mjs`
  - `start.mjs`
  - vendored native module
  - prebuilds for supported targets
  - `prebuilds/VERSION`

Exit criteria:

- release artifacts are validated before publish

### 5. Add Install Verification Matrix

Create a simple verification script or CI job for each supported target:

- clean install from tarball
- run `context-mode-doltlite doctor`
- run `node start.mjs`
- verify the server can report `Engine: prolly`

Exit criteria:

- supported targets are proven from packaged artifacts, not just local dev trees

### 6. Document Developer Rebuild Workflow Separately

Keep local developer rebuild instructions, but separate them clearly from
end-user install docs.

Developer-only path should cover:

- building Doltlite from source
- setting `DOLTLITE_BUILD_DIR`
- running `patch-doltlite.mjs`
- rebuilding bundles

Exit criteria:

- end-user docs do not imply a local Doltlite checkout is required

## Commit / Release Order

Recommended sequence:

1. commit current Linux prebuild and rebuilt bundles
2. commit support-matrix docs
3. patch fallback behavior in `postinstall.mjs` / `patch-doltlite.mjs`
4. add CI packaging checks
5. add more platform prebuilds
6. publish only after packaged install verification passes

## Immediate Next Step

Before any broader rollout, commit the current shipped runtime artifacts so
`main` reflects the Doltlite version that the local install is already using:

- `prebuilds/VERSION`
- `prebuilds/linux-x64/node.abi127.node`
- `server.bundle.mjs`
- `cli.bundle.mjs`

