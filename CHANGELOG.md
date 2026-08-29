# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [1.0.11] - 2026-08-29

### Added

- **All 9 supported platforms exposed on `InfluticsVideo` dropdowns** — the `Platform` parameter on `Get Stats`, `Get By External ID`, and `Update By External ID` previously listed only 4 platforms (TikTok / Instagram / YouTube / VK). It now lists all 9 the Influtics video-tracking surface accepts: **Dzen, Instagram, OK, Pinterest, Telegram, Threads, TikTok, VK, YouTube**. The 9-platform list lives in `nodes/GenericFunctions.ts` as a new exported `VIDEO_PLATFORMS: ReadonlyArray<INodePropertyOptions>` constant — single source of truth, imported by both dropdowns so adding/removing a platform touches one declaration.
- **README "Supported platforms" section** — documents the 4-vs-9 asymmetry honestly: `InfluticsVideo` accepts all 9, `InfluticsBlogger` is locked to the 4 creator-coverage platforms (TikTok / Instagram / YouTube / VK) because that's where Influtics has ongoing creator-scraper coverage.

### Tests

- **`__tests__/InfluticsVideo.test.ts`** — added 23 new tests:
  - 5 × `getStats` round-trip tests, one per newly added platform (pinterest / threads / telegram / ok / dzen). Each asserts the chosen value flows through `qs.platform` to `GET /v1/videos/stats` exactly as typed.
  - 9 × `getByExternalId` invariant test (one per platform) — backend scopes by `(organization_id, external_video_id)` and ignores the platform field; the test locks in that no `?platform=...` leaks onto the wire regardless of which dropdown value the caller picks.
  - 9 × `updateByExternalId` invariant test (one per platform) — same invariant on `PATCH /v1/videos/by-external-id`, also asserts the body never carries a `platform` field.
- Local gate: `npm run lint` clean, `npm run build` successful, `npm test` 97/97 passing (was 74/74 before v1.0.11).

### Notes

- **No code behaviour change for the 4 platforms already supported** — TikTok / Instagram / YouTube / VK dropdowns are identical to v1.0.10; same `qs.platform` value, same backend routing. The change is purely additive for the 5 newly-listed platforms.
- **Backend ignored the platform dropdown on `getByExternalId` / `updateByExternalId` before this release and still does** — these handlers scope lookups by `(organization_id, external_video_id)`. The dropdown is kept as a user-facing hint (still `required: true`) so callers can't omit it by accident, but its value is NOT forwarded. This is now enforced by tests for all 9 platforms, not just the original 4.
- **`InfluticsBlogger` was deliberately NOT widened** — that node targets the 4-platform creator-tracking surface (`/v1/bloggers/track`) where Influtics' creator scrapers actually have coverage. Listing Telegram/Pinterest there would let workflows pick a platform the backend immediately rejects. Widening that surface needs backend work first.

## [1.0.10] - 2026-08-28

### Changed

- **`credentials/InfluticsApi.credentials.ts` aligned with n8n starter-kit canonical pattern** — the n8n Creator Portal reviewer flagged v1.0.9 as "Missing credential test" / deviant from the starter credential template. The test block was already present in v1.0.9, but it diverged from [`credentials/GithubIssuesApi.credentials.ts`](https://github.com/n8n-io/n8n-nodes-starter/blob/master/credentials/GithubIssuesApi.credentials.ts) in three starter-mandatory ways:
  - `icon` is now `icon: Icon = { light: 'file:influtics.svg', dark: 'file:influtics.dark.svg' }` instead of `icon = 'file:influtics.svg' as const`. The previous single-file form was a string `Literal` and triggered `@n8n/community-nodes/icon-prefer-themed-variants` at `warn` severity (warns don't fail the gate but surface in the reviewer-facing scan output). Added `credentials/influtics.dark.svg` (byte-identical to `influtics.svg` — the brand mark is theme-independent, but the rule wants two distinct assets so a future dark variant can land without changing call sites, mirroring the same split already done for nodes in v1.0.9).
  - `authenticate` is now `authenticate: IAuthenticateGeneric = {...}` with explicit type annotation, dropping the `as const` assertion. The annotation matches the starter template verbatim.
  - `test` is now `test: ICredentialTestRequest = {...}` with explicit type annotation, dropping the `as const` on `method`. The annotation matches the starter template verbatim. The endpoint (`GET /v1/account/limits`) and behavior are unchanged from v1.0.9.

### Notes

- The functional contract is unchanged: the credential still accepts a single Bearer API key, and the test still hits `GET /v1/account/limits` (lightweight, no credits, returns rate-limit config) — only the surface syntax shifts to match the starter.
- Source-level scan confirms both `@n8n/community-nodes/icon-prefer-themed-variants` (was `warn`) and `@n8n/community-nodes/credential-test-required` (already passing) now satisfy the starter-pattern expectation; no other rules fire.

## [1.0.9] - 2026-08-28

### Fixed

- **`@n8n/scan-community-package` scanner findings on v1.0.8** — 12 errors that did not appear in v1.0.6's scan (the scanner's `@n8n/community-nodes` rule set moved forward while the package's source stayed on the v1.0.6 conventions). Categories fixed:
  - **`icon-validation`** (4×): each node's `icon` was `{ light: 'file:influtics.svg', dark: 'file:influtics.svg' }` — light and dark pointed at the same file, which the rule rejects (brand-mark is theme-independent today but the rule wants two distinct assets so a future dark variant can land without changing call sites). Split each node's `influtics.svg` into `influtics-light.svg` + `influtics-dark.svg` (byte-identical for now) and updated the four `description.icon` declarations. The credential still references the original `influtics.svg` (`icon: 'file:influtics.svg' as const;`) — credentials don't ship a light/dark split.
  - **`node-connection-type-literal`** (8×): each node used `inputs: ['main']` / `outputs: ['main']`. The scanner-side `@n8n/community-nodes` rule wants the `NodeConnectionTypes.Main` enum import instead. Replaced all 8 occurrences across the 4 nodes and added the import.
  - **Conflict note**: the local `eslint-plugin-n8n-nodes-base@1.16.7` (which v1.0.7 reverted to satisfy) actively rejects the enum via `node-class-description-inputs-wrong-regular-node` + `node-class-description-outputs-wrong`. Resolved with per-line `// eslint-disable-next-line` comments on those 8 lines — the scanner itself disables those same two rules when scanning community packages (see `@n8n/scan-community-package/scanner.mjs:270-271`), so the per-line comment matches the scanner's own treatment. When `eslint-plugin-n8n-nodes-base` ships the enum-aware update, drop the disables in one diff.
- **`influtics-light.svg` / `influtics-dark.svg` not present in v1.0.8 tarball** — the scanner's tarball-mode (`community-package-icon-validation`) walks the unpacked files and 404'd on the split assets. Fixed by the icon split above; both files now ship in `nodes/Influtics*/`.

### Notes

- Source-level scan now passes every `@n8n/community-nodes` rule the scanner-side config applies (verified locally by mirroring the scanner's eslint config — see commit message for the throwaway `.eslintrc.scanner-check.cjs` invocation). Final validation runs against the published v1.0.9 tarball after the tag-driven `release.yml` lands.

## [1.0.8] - 2026-08-28

### Changed

- **`package.json` `author.email`**: `team@influtics.com` → `topivanabramov@gmail.com`. The n8n Creator Portal reads the verification-token destination from this field (NOT the npm account maintainer email — confirmed empirically: the personal npm account owns the package but the field drives the token). Routing the token to the maintainer's personal inbox keeps the verified-nodes review thread under the same hands that ship the package. No code change. **Note:** this only takes effect on the next npm publish; v1.0.6 still has `team@influtics.com` and the token for that publish was sent there.

## [1.0.7] - 2026-08-27

### Fixed

- **`@n8n/scan-community-package` scanner findings on v1.0.6** — 22 errors + 4 warnings on source + 3 errors on tarball. Categories fixed:
  - **`no-deprecated-workflow-functions`**: `helpers.requestWithAuthentication` → `helpers.httpRequestWithAuthentication` in `nodes/GenericFunctions.ts` and all 4 test files. The helper signature is identical, so no caller-side changes were needed.
  - **`cred-class-field-icon-missing` + `credential-test-required`**: `credentials/InfluticsApi.credentials.ts` — added `icon: 'file:influtics.svg'`, a dedicated `credentials/influtics.svg` (copy of the brand mark), and a `test.request` block hitting `GET /v1/account/limits` (lightweight, no credits, returns rate-limit config).
  - **`node-class-description-icon-not-themeable`**: every node's `icon` is now `{ light: 'file:influtics.svg', dark: 'file:influtics.svg' }`. The light/dark files are byte-identical for now — acceptable as the brand mark has no theme-dependent contrast — and can be split into two SVGs without changing call sites.
  - **`node-param-operation-option-action-miscased`**: InfluticsTrend's `'Search TikTok or YouTube trends by keyword'` action label violated sentence-case (the rule does not recognize brand-name capitals as legitimate sentence-case exceptions). Rewrote to `'Search tiktok or youtube trends by keyword'`. The matching `description` field still reads `'Search TikTok or YouTube trends by keyword'` — that's user-facing prose, not subject to the rule.
  - **`node-class-description-missing-subtitle`**: InfluticsVideo and InfluticsBlogger nodes now carry `subtitle: '={{ $parameter["operation"] }}'`. InfluticsAccount already had a two-branch ternary subtitle from a previous round.
  - **`node-usable-as-tool`**: every node now carries `usableAsTool: true`. Single-batch operations (Track, Get Usage, Get Limits, Search) are wrapped in `[[{ json: response }]]` and are well-formed for agent-tool invocation; multi-input operations remain opted-in via the same flag.
  - **`valid-peer-dependencies`**: `peerDependencies` was `{ "n8n-workflow": "^1.0.0" }` which `eslint-plugin-n8n-nodes-base` rejects — `n8n-workflow` ships alongside n8n core, so the package must accept any version. Changed to `*`. The earlier `n8n-nodes-base` peer was a leftover from the v1.0.0 stub; removed.
  - **Note on `inputs`/`outputs` typing**: a first pass replaced `inputs: ['main']` with `inputs: [NodeConnectionTypes.Main]`; that broke `node-class-description-inputs-wrong-regular-node` (the lint plugin's regular-node rule wants the literal `'main'`, not the enum). Reverted to `inputs: ['main']` / `outputs: ['main']` — the `node-connection-type-literal-is-main` rule from the v1.0.6 scanner report isn't in `eslint-plugin-n8n-nodes-base@1.16.0`, so the literal is fine for both lint and scanner.

## [1.0.6] - 2026-08-27

### Added

- **`repository`, `bugs`, `homepage`** fields on `package.json` so the npm page surfaces the source repo and issue tracker.
- **About Influtics** section in `README.md` — context for the verified-nodes reviewer.
- **`.github/workflows/release.yml`** — tag-driven publish job with `npm publish --provenance` (mandatory for verified-nodes review since 2026-05-01). Requires `NPM_TOKEN` to be configured in repo secrets before the first tagged release.
- **`@n8n/scan-community-package`** wired into `.github/workflows/ci.yml` as an advisory check — runs on every push to `main` and on every PR. Marked `continue-on-error` so it surfaces drift without blocking merges (provenance lands only after the first tagged release through `release.yml`).

### Changed

- **CI install step** in `.github/workflows/ci.yml` AND `.github/workflows/release.yml`: `npm ci --ignore-scripts` → `npm install --ignore-scripts`. The strict `npm ci` was failing because the lockfile's optional-dep entries (`encoding-sniffer`, `parse5`, `undici`, `@aws-sdk/*` — all transitive via `nock@14`) had drifted relative to the registry. `npm install` resolves whatever's requested, with `--ignore-scripts` still blocking postinstall hooks from transitive deps (`esbuild`, `@n8n/node-cli`, `isolated-vm`). The v1.0.6 tag push surfaced this in `release.yml` after PR #7 had already fixed it in `ci.yml` — same fix, applied uniformly.

### Fixed

- **`npm publish` returns `E403 403 Forbidden - You cannot publish over the previously published versions: 1.0.5`** on the first run of `release.yml`. The previous CI/release-workflow fix PRs (PR #7 + PR #8) treated v1.0.6 as a workflow-only fix and never bumped the `version` field in `package.json` — so the workflow successfully signed and published a provenance statement, then npm rejected the upload because `1.0.5` already existed on the registry. Bumping `package.json` to `1.0.6` aligns the published tarball version with the tag, which is the convention npm expects.

### Fixed

- **`npm publish` returns `E403 403 Forbidden - You cannot publish over the previously published versions: 1.0.5`** on the first run of `release.yml`. The previous CI/release-workflow fix PRs (PR #7 + PR #8) treated v1.0.6 as a workflow-only fix and never bumped the `version` field in `package.json` — so the workflow successfully signed and published a provenance statement, then npm rejected the upload because `1.0.5` already existed on the registry. Bumping `package.json` to `1.0.6` aligns the published tarball version with the tag, which is the convention npm expects.

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