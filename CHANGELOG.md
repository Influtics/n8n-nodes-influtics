# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added

- **`repository`, `bugs`, `homepage`** fields on `package.json` so the npm page surfaces the source repo and issue tracker.
- **About Influtics** section in `README.md` — context for the verified-nodes reviewer.
- **`.github/workflows/release.yml`** — tag-driven publish job with `npm publish --provenance` (mandatory for verified-nodes review since 2026-05-01). Requires `NPM_TOKEN` to be configured in repo secrets before the first tagged release.
- **`@n8n/scan-community-package`** wired into `.github/workflows/ci.yml` as an advisory check — runs on every push to `main` and on every PR. Marked `continue-on-error` so it surfaces drift without blocking merges (provenance lands only after the first tagged release through `release.yml`).

### Changed

- **CI install step** in `.github/workflows/ci.yml`: `npm ci --ignore-scripts` → `npm install --ignore-scripts`. The strict `npm ci` was failing on this branch because the lockfile's optional-dep entries (`encoding-sniffer`, `parse5`, `undici`, `@aws-sdk/*` — all transitive via `nock@14`) had drifted relative to the registry. `npm install` resolves whatever's requested, with `--ignore-scripts` still blocking postinstall hooks from transitive deps (`esbuild`, `@n8n/node-cli`, `isolated-vm`).

## [1.0.5] - 2026-08-27

### Fixed

- **`Error loading package: Unexpected token '*'`** on n8n 2.10.x install. The previous package.json declared `n8n.nodes` and `n8n.credentials` as glob patterns (`dist/nodes/**/*.node.js`, `dist/credentials/**/*.credentials.js`). n8n's `PackageDirectoryLoader.loadAll()` does NOT expand globs — it iterates the array raw and feeds each entry to `directory-loader.ts:loadClass()`, which extracts the className via `path.parse(sourcePath).name.split('.')[0]`. For a glob entry like `dist/nodes/**/*.node.js`, that resolves to `className = "**"`, which is then interpolated into n8n's `vm.Script` template literal `new (require('${filePath}').${className})()`. V8 parses that source and throws `SyntaxError: Unexpected token '*'` BEFORE `require()` is ever called.
  - `package.json`: replaced glob patterns with explicit file paths.
  - Verified end-to-end: a faithful replica of `PackageDirectoryLoader → loadNodeFromFile → loadClass → loadClassInIsolation` passes 5/5 on v1.0.5 and fails with the exact user-reported error on v1.0.4.
  - README troubleshooting section rewritten to reflect this root cause (the previous "stale install cache" hypothesis was incorrect).

### Notes

- No code or build-output changes in the per-node `.js` files — only the package.json `n8n` field. v1.0.4's CJS dist is reused as-is.

## [1.0.4] - 2026-08-27

### Added

- **Troubleshooting** section in `README.md` covering `Error loading package: Unexpected token '*'` — the dominant user-facing error after upgrade. n8n's community-node installer reuses the on-disk folder between upgrades, so a broken prior version (≤1.0.2) leaves broken files in place even after installing v1.0.3. The new section gives Docker-volume and bare-metal steps to wipe the install cache and reinstall cleanly.

### Notes

- No code changes in this release. v1.0.3 is verifiably clean (CommonJS, no ESM imports that V8 script mode rejects); the `loadClassInIsolation` smoketest against `npm pack` output passes 5/5 on Node 23 and Node 24, with both `n8n-workflow@1.120.0` and `@1.120.28`.

## [1.0.3] - 2026-08-27

### Fixed

- Switched the package from ESM to CommonJS. n8n 2.10.4 loads community nodes via `loadClassInIsolation`, which compiles `new (require('<file>').ClassName)()` with V8 in script mode inside a `vm.Script` context. With `"type": "module"` and TypeScript `module: "NodeNext"`, the published `dist/index.js` was ESM and required Node 24's `require(esm)` interop to load `n8n-workflow`. That interop routed `import 'n8n-workflow'` to `n8n-workflow@1.120.x`'s `dist/esm/index.js`, which contains `import * as X from './X'` statements (no `.js` extension) that V8 rejects in script mode with `Unexpected token '*'`. Reverting to CJS means `require('n8n-workflow')` resolves via the `require` condition to `dist/cjs/index.js` (valid CJS) — no `vm.Script`/`require(esm)` indirection.
  - `package.json`: removed `"type": "module"`.
  - `tsconfig.json`: `module: "NodeNext"` → `"CommonJS"`, `moduleResolution: "NodeNext"` → `"Node"`.
  - `index.ts` and the four node files: dropped the `.js` import suffixes (TS + CJS don't need them).
  - Build output verified: `dist/index.js` now emits `"use strict"; Object.defineProperty(exports, "__esModule", ...)` + `require(...)`, loadable through n8n's `vm.Script` sandbox.

## [1.0.2] - 2026-08-27

### Fixed

- `package.json` declares `"main": "dist/index.js"` but no such file was emitted. n8n's loader resolves `main` first; the missing entry surfaced as `Error loading package: Unexpected token '*'` even though the per-node globs (`dist/nodes/**/*.node.js`) resolved correctly. Added an `index.ts` at the project root that re-exports every node + the credential, so the build emits `dist/index.js`. `tsconfig.json` `include` updated to pick it up.

## [1.0.1] - 2026-08-26

### Fixed

- Published `1.0.0` tarball was empty (LICENSE + README + package.json only — no `dist/`). n8n surfaced it as `Error loading package: Unexpected token '*'` because the `dist/nodes/**/*.node.js` glob resolved to nothing. The `prepublishOnly` script is now wired so `npm publish` always builds, lints, and tests first; v1.0.1 ships the missing `dist/` artifacts.

## [1.0.0] - 2026-08-24

First public community-node release. Covers the full Influtics public REST API surface:

- InfluticsApi credential (single Bearer API key).
- InfluticsVideo node (5 operations).
- InfluticsBlogger node (3 operations, async Track returns job_id).
- InfluticsTrend node (1 operation).
- InfluticsAccount node (2 operations).
- GenericFunctions transport + error mapper.
- Vitest + nock test suite.
- GitHub Actions CI (lint + test on every push/PR).