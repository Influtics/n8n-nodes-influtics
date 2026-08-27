# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

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