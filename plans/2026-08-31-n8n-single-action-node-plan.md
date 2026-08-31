# Consolidate `n8n-nodes-influtics` to a Single Action Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the four separate `Influtics*` n8n community nodes (`Account`, `Blogger`, `Trend`, `Video`) with a single `Influtics` action node exposing each surface as a Resource, satisfying the n8n verified-nodes guideline HIGH-severity feedback.

**Architecture:** One `Influtics.node.ts` (glue + dispatcher + `INodeTypeDescription`) at `nodes/Influtics/Influtics.node.ts`, plus four sibling resource modules under `nodes/Influtics/resources/{account,blogger,trend,video}.ts`. Each resource module exports an `OPERATIONS` map and a `properties()` factory. `displayOptions.show.resource` scopes the per-resource Operation dropdown, and `displayOptions.show.resource + operation` scopes each parameter — verified-nodes pattern (HubSpot / Notion / Airtable).

**Tech Stack:** TypeScript, n8n-workflow (`INodeType`, `INodeTypeDescription`, `NodeConnectionTypes`), `influticsApiRequest` (existing `nodes/GenericFunctions.ts` — unchanged), Vitest + nock + vitest-mock-extended for tests, `eslint-plugin-n8n-nodes-base`, `@n8n/node-cli build`, `@n8n/scan-community-package`.

**Worktree:** `/Users/ivanabramov/Desktop/n8n x Influtics/.worktrees/single-action-node/`
**Branch:** `feat/single-action-node`
**Target version:** `1.1.0` (breaking — bumped from `1.0.10`)

**Approved spec:** [`plans/2026-08-31-n8n-single-action-node-design.md`](./2026-08-31-n8n-single-action-node-design.md)

---

## File structure

The implementation rewires files. Below is the final state of every file this plan touches:

**New files:**
- `nodes/Influtics/Influtics.node.ts` (~120 LOC) — class `Influtics`, `executeInflutics`, `OPERATIONS` map, `OperationHandler` type
- `nodes/Influtics/influtics-light.svg` — copied from `nodes/InfluticsVideo/influtics-light.svg`
- `nodes/Influtics/influtics-dark.svg` — copied from `nodes/InfluticsVideo/influtics-dark.svg`
- `nodes/Influtics/resources/account.ts` (~115 LOC) — port of InfluticsAccount handlers + properties
- `nodes/Influtics/resources/blogger.ts` (~210 LOC) — port of InfluticsBlogger handlers + properties
- `nodes/Influtics/resources/trend.ts` (~150 LOC) — port of InfluticsTrend handlers + properties
- `nodes/Influtics/resources/video.ts` (~330 LOC) — port of InfluticsVideo handlers + properties
- `__tests__/helpers/mockContext.ts` (~60 LOC) — extracted shared mock helper
- `__tests__/dispatcher.test.ts` (~120 LOC) — Tier-2 routing smoke tests
- `__tests__/account.test.ts` (~340 LOC) — port of InfluticsAccount.test.ts
- `__tests__/blogger.test.ts` (~540 LOC) — port of InfluticsBlogger.test.ts
- `__tests__/trend.test.ts` (~560 LOC) — port of InfluticsTrend.test.ts
- `__tests__/video.test.ts` (~800 LOC) — port of InfluticsVideo.test.ts

**Modified files:**
- `index.ts` — export only `Influtics`
- `package.json` — version 1.1.0, `n8n.nodes` array consolidated, `single-action-node` keyword
- `CHANGELOG.md` — `[1.1.0]` BREAKING entry
- `README.md` — upgrade callout, four operations tables (one per resource), troubleshooting section

**Deleted (after all tests pass + scanner clean):**
- `nodes/InfluticsAccount/` (4 files: node + 3 SVGs)
- `nodes/InfluticsBlogger/` (4 files: node + 3 SVGs)
- `nodes/InfluticsTrend/` (4 files: node + 3 SVGs)
- `nodes/InfluticsVideo/` (4 files: node + 3 SVGs — keep light/dark SVGs; bare influtics.svg is unused and goes)
- `__tests__/InfluticsAccount.test.ts`
- `__tests__/InfluticsBlogger.test.ts`
- `__tests__/InfluticsTrend.test.ts`
- `__tests__/InfluticsVideo.test.ts`

**Untouched:** `nodes/GenericFunctions.ts`, `__tests__/GenericFunctions.test.ts`, `credentials/InfluticsApi.credentials.ts`, `credentials/influtics.svg`, `credentials/influtics.dark.svg`, `vitest.config.ts`, `tsconfig.json`.

---

## Execution order & dependencies

The plan is ordered so that no step leaves the repo broken:

1. **Phase 1 — Scaffold + skeleton**: scaffold new node folder + SVGs + dispatcher (without operation handlers wired yet), set `n8n.nodes` to BOTH old + new entry points so old nodes still load.
2. **Phase 2 — Resource modules (TDD)**: build each resource module + its test port in isolation. Each module is independently testable. Run lint + tests after each module.
3. **Phase 3 — Wire dispatcher to all resources**: integrate the OPERATIONS map into `Influtics.node.ts`, port test files to drive modules directly, add dispatcher tests.
4. **Phase 4 — Manifest + index + docs**: package.json bump, single-entry n8n.nodes array, `index.ts` exports, CHANGELOG, README.
5. **Phase 5 — Pre-publish gate**: lint, full test, build, scan-community-package. Delete old node folders + tests. Confirm scanner is clean against final shape.
6. **Phase 6 — Release**: tag v1.1.0, push tag, reply to n8n verification team.

Why this order? Each phase ends with the test suite green. A failure mid-phase surfaces immediately against a small blast radius, not against the full integration.

**Precondition (must hold before Phase 6):** `feat/single-action-node` merged to `main` via PR (see design §7.2). The tag-push publish trigger runs the release workflow against the branch the tag is on, and tag pushes from a feature branch can race with the merge.

---

## Phase 1 — Scaffold + skeleton

### Task 1: Create node folder and copy SVGs

**Files:**
- Create: `nodes/Influtics/influtics-light.svg` (copy from `nodes/InfluticsVideo/influtics-light.svg`)
- Create: `nodes/Influtics/influtics-dark.svg` (copy from `nodes/InfluticsVideo/influtics-dark.svg`)

- [ ] **Step 1: Create directory and copy SVGs**

```bash
mkdir -p nodes/Influtics
cp nodes/InfluticsVideo/influtics-light.svg nodes/Influtics/influtics-light.svg
cp nodes/InfluticsVideo/influtics-dark.svg  nodes/Influtics/influtics-dark.svg
ls -la nodes/Influtics/
```

Expected: `influtics-dark.svg`, `influtics-light.svg` both present. Sizes match the source files byte-for-byte (`md5` identical).

- [ ] **Step 2: Verify bytes match**

```bash
md5 nodes/InfluticsVideo/influtics-light.svg nodes/Influtics/influtics-light.svg
md5 nodes/InfluticsVideo/influtics-dark.svg  nodes/Influtics/influtics-dark.svg
```

Expected: each pair prints two identical hashes (the light/dark files are byte-identical today — that is the v1.0.9 split; see `CHANGELOG.md` v1.0.9).

- [ ] **Step 3: Commit**

```bash
git add nodes/Influtics/influtics-light.svg nodes/Influtics/influtics-dark.svg
git commit -m "feat(nodes): scaffold Influtics node folder + brand mark SVGs"
```

---

### Task 2: Create skeleton `Influtics.node.ts` with empty OPERATIONS map

**Files:**
- Create: `nodes/Influtics/Influtics.node.ts` (~80 LOC scaffold)

- [ ] **Step 1: Create the skeleton file**

The scaffold exports `class Influtics implements INodeType`, `executeInflutics`, and the `OperationHandler` type. Operations point at empty per-resource maps — they are filled in by the resource modules (Phases 2–3). The `properties()` factory imports are stubbed for now; we'll wire them in Task 3+.

```typescript
/**
 * Influtics single action node (v1.1.0).
 *
 * Consolidates Influtics Account / Blogger / Trend / Video into one node per
 * the n8n verified-nodes "one regular node per package" guideline.
 *
 * Implementation choices:
 * - File lives at nodes/Influtics/Influtics.node.ts — required by
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention`.
 * - `executeInflutics` is also exported as a named function so unit tests can
 *   drive the dispatcher without instantiating the INodeType class.
 * - Per-resource OperationHandler maps live in `resources/{name}.ts`; the
 *   dispatcher below looks up `OPERATIONS[resource][operation]`.
 * - The unimplemented-resource / unimplemented-operation branch keeps the
 *   executor safe if a future version's parameters somehow leak an unknown
 *   value.
 */
import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { accountProperties, ACCOUNT_OPERATIONS } from './resources/account';
import { bloggerProperties, BLOGGER_OPERATIONS } from './resources/blogger';
import { trendProperties,   TREND_OPERATIONS }   from './resources/trend';
import { videoProperties,   VIDEO_OPERATIONS }   from './resources/video';

export type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

type ResourceKey = 'account' | 'blogger' | 'trend' | 'video';

const OPERATIONS: Record<ResourceKey, Record<string, OperationHandler>> = {
  account: ACCOUNT_OPERATIONS,
  blogger: BLOGGER_OPERATIONS,
  trend:   TREND_OPERATIONS,
  video:   VIDEO_OPERATIONS,
};

export async function executeInflutics(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const resource = this.getNodeParameter('resource', 0) as ResourceKey;
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[resource]?.[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not implemented for resource "${resource}"`,
    );
  }
  // All eleven ops are single-batch: one HTTP call per workflow run regardless
  // of input item count. Mirrors the InfluticsAccount/Video/Trend/Blogger
  // single-batch patterns.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class Influtics implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics',
    name: 'influtics',
    icon: { light: 'file:influtics-light.svg', dark: 'file:influtics-dark.svg' },
    group: ['transform'],
    // Bumped from 1 (the four old nodes were version 1). Breaking change is
    // declared in CHANGELOG v1.1.0; existing workflows must be re-created.
    version: 2,
    subtitle: '={{$parameter["resource"]}} → {{$parameter["operation"]}}',
    description: 'Track videos, manage bloggers, search trends, and read account usage',
    defaults: { name: 'Influtics' },
    // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node -- scanner `@n8n/community-nodes/node-connection-type-literal` requires the enum; the local plugin (1.16.0) wants the literal and is stale against newer n8n-workflow APIs.
    inputs: [NodeConnectionTypes.Main],
    // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong -- scanner requires the enum (see inputs comment above); satisfying it is what blocks v1.1.0 ship.
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Account', value: 'account' },
          { name: 'Blogger', value: 'blogger' },
          { name: 'Trend',   value: 'trend'   },
          { name: 'Video',   value: 'video'   },
        ],
        default: 'video',
      },
      ...accountProperties(),
      ...bloggerProperties(),
      ...trendProperties(),
      ...videoProperties(),
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInflutics.call(this, this.getInputData());
  }
}
```

- [ ] **Step 2: Create stub resource modules (so the imports compile)**

Each resource module needs to export `*_OPERATIONS` and `*Properties()`. Stub them minimally:

```bash
mkdir -p nodes/Influtics/resources
```

For each of `account.ts`, `blogger.ts`, `trend.ts`, `video.ts` create the file with:

```typescript
- [ ] **Step 1: Create the directory**

```bash
mkdir -p nodes/Influtics/resources
```

- [ ] **Step 2: Create stub resource modules (so the imports compile)**

Each resource module needs to export `*_OPERATIONS` and `*Properties()`. Stub them minimally. For each of `account.ts`, `blogger.ts`, `trend.ts`, `video.ts` create the file with:

```typescript
// nodes/Influtics/resources/<name>.ts
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import type { OperationHandler } from '../Influtics.node';

export const <NAME>_OPERATIONS: Record<string, OperationHandler> = {
  // TODO(task-N): port handlers from nodes/Influtics<Name>/Influtics<Name>.node.ts
};

export function <name>Properties(): INodeProperties[] {
  return [];
}
```

Replace `<NAME>` and `<name>` with `ACCOUNT`/`account`, `BLOGGER`/`blogger`, `TREND`/`trend`, `VIDEO`/`video` respectively.

- [ ] **Step 3: Verify TS compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors. (The four stub resource modules compile because they export the right shapes.)

- [ ] **Step 4: Verify lint clean**

```bash
npm run lint
```

Expected: 0 errors. (The two `eslint-disable-next-line` comments are required and explicit.)

- [ ] **Step 5: Commit**

```bash
git add nodes/Influtics/Influtics.node.ts nodes/Influtics/resources/
git commit -m "feat(nodes): single Influtics action node skeleton + dispatcher"
```

---

### Task 3: Register new node in `package.json` alongside old nodes

**Files:**
- Modify: `package.json` (`n8n.nodes` array — currently spans lines 73–78)

- [ ] **Step 1: Add the new entry while keeping the old four**

The new node co-exists with the four old ones during Phases 2–5 so the test suite stays green throughout. The deletion of the four old entries is the very last manifest edit (Task 28).

Edit `package.json` `n8n.nodes` array so it reads (in this order):

```json
"n8n": {
  "n8nNodesApiVersion": 1,
  "nodes": [
    "dist/nodes/Influtics/Influtics.node.js",
    "dist/nodes/InfluticsAccount/InfluticsAccount.node.js",
    "dist/nodes/InfluticsBlogger/InfluticsBlogger.node.js",
    "dist/nodes/InfluticsTrend/InfluticsTrend.node.js",
    "dist/nodes/InfluticsVideo/InfluticsVideo.node.js"
  ],
  "credentials": [
    "dist/credentials/InfluticsApi.credentials.js"
  ]
}
```

- [ ] **Step 2: Verify build still succeeds**

```bash
npm run build
```

Expected: `dist/nodes/Influtics/Influtics.node.js` exists alongside the four old `dist/nodes/Influtics*/Influtics*.node.js` files. No errors.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(manifest): register Influtics node (co-exists with legacy nodes)"
```

---

## Phase 2 — Resource modules (TDD per resource)

Each resource module is built test-first. The pattern is the same for all four; only the handlers and properties differ.

### Task 4: Create `__tests__/helpers/mockContext.ts`

**Files:**
- Create: `__tests__/helpers/mockContext.ts` (~60 LOC)

- [ ] **Step 0: Create the directory**

```bash
mkdir -p __tests__/helpers
```

- [ ] **Step 1: Create the shared helper file**

- [ ] **Step 1: Create the shared helper**

The helper extracts the inline `makeCtx` from each existing test file into a single source-of-truth used by all per-resource tests. Keep the `nock` interception of `httpRequestWithAuthentication` — that's how real `IExecuteFunctions.httpRequestWithAuthentication` behaves (returns parsed JSON on 2xx, throws with `error.response.body` populated on non-2xx).

```typescript
/**
 * Shared mock factory for resource handler tests.
 *
 * Mirrors n8n's real `httpRequestWithAuthentication` helper:
 *   - 2xx → returns the parsed JSON body directly
 *   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
 * `GenericFunctions.mapInfluticsError` reads `rawError.response.body.error`.
 *
 * Usage:
 *   const ctx = makeMockContext({ resource: 'video', operation: 'track',
 *     urls: { urls: ['https://tiktok.com/@x/video/1'] } });
 *   await VIDEO_OPERATIONS.track.call(ctx as any, 0);
 */
import { vi } from 'vitest';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';

export const BASE_URL = 'https://api.influtics.com';

export function makeMockContext(params: Record<string, unknown> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'Influtics', type: 'n8n-nodes-influtics.influtics', typeVersion: 2 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string, _i: number, defaultValue?: unknown) =>
    params[name] ?? defaultValue,
  );
  ctx.helpers = {
    httpRequestWithAuthentication: vi.fn(async (_name, opts) => {
      const res = await fetch((opts as any).uri ?? (opts as any).url, {
        method: (opts as any).method,
        headers: (opts as any).headers,
        body: (opts as any).body ? JSON.stringify((opts as any).body) : undefined,
      });
      const text = await res.text();
      const parsed = text ? JSON.parse(text) : null;
      if (res.status >= 400) {
        const err: any = new Error(`Request failed with status ${res.status}`);
        err.response = { statusCode: res.status, body: parsed };
        throw err;
      }
      return parsed;
    }),
  } as any;
  return ctx;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add __tests__/helpers/mockContext.ts
git commit -m "test(helpers): extract shared makeMockContext + BASE_URL"
```

---

### Task 5: Implement `resources/account.ts` (TDD)

**Files:**
- Modify: `nodes/Influtics/resources/account.ts`
- Create: `__tests__/account.test.ts`

- [ ] **Step 1: Write the failing test**

Port `__tests__/InfluticsAccount.test.ts` verbatim — same `nock(...)` blocks, same assertions — but:
- Replace import: `import { executeInfluticsAccount } from '../nodes/InfluticsAccount/InfluticsAccount.node';` → `import { ACCOUNT_OPERATIONS } from '../nodes/Influtics/resources/account';`
- Replace each `executeInfluticsAccount.call(ctx, [{json:{}}])` → `ACCOUNT_OPERATIONS.getUsage.call(ctx as any, 0)` / `ACCOUNT_OPERATIONS.getLimits.call(ctx as any, 0)`
- Update `makeCtx` to use the shared `makeMockContext` from `__tests__/helpers/mockContext`, with `resource: 'account'` set by default
- For the "single-batch invariant" tests, wrap each OPERATIONS call in `[[ { json: response } ]]` assertion shape (since these now call the handler directly, not the executor)

The expected test count: 8 tests (2 happy path, 4 error / 2 single-batch — same as `__tests__/InfluticsAccount.test.ts`).

```typescript
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import nock from 'nock';
import { ACCOUNT_OPERATIONS } from '../nodes/Influtics/resources/account';
import { BASE_URL, makeMockContext } from './helpers/mockContext';

describe('account.getUsage', () => {
  beforeAll(() => { nock.disableNetConnect(); });
  afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); });

  it('GETs /v1/account/usage with no qs and no body', async () => {
    const ctx = makeMockContext({ resource: 'account', operation: 'getUsage' });

    nock(BASE_URL)
      .get('/v1/account/usage')
      .reply(200, {
        success: true,
        data: {
          usage_history: [
            { created_at: '2026-08-23', endpoint: '/v1/videos/stats', credits_used: 0 },
            { created_at: '2026-08-22', endpoint: '/v1/videos/track', credits_used: 1 },
          ],
          summary: { plan: 'pro', is_unlimited: false,
            videos: { limit: 1000, used: 200 }, credits: { total: 1000, used: 312 } },
        },
        meta: { processing_time_ms: 42, request_id: 'req-usage-1' },
      });

    const result = await ACCOUNT_OPERATIONS.getUsage.call(ctx as any, 0);

    expect((result as any).data).toEqual({
      usage_history: [
        { created_at: '2026-08-23', endpoint: '/v1/videos/stats', credits_used: 0 },
        { created_at: '2026-08-22', endpoint: '/v1/videos/track', credits_used: 1 },
      ],
      summary: { plan: 'pro', is_unlimited: false,
        videos: { limit: 1000, used: 200 }, credits: { total: 1000, used: 312 } },
    });
    expect((result as any).meta.request_id).toBe('req-usage-1');
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
    expect(callArgs.body).toBeUndefined();
  });
});
// ... port the remaining 5 tests in the same shape ...
```

- [ ] **Step 2: Run the test, verify it fails**

```bash
npm test -- account.test.ts
```

Expected: FAIL with `Cannot find module '../nodes/Influtics/resources/account'` or `ACCOUNT_OPERATIONS` is undefined. (The stub from Task 2 has `ACCOUNT_OPERATIONS: Record<string, OperationHandler> = {}` — empty map — so even with the import resolving, every call to a named handler will fail with `handler is not a function`.)

- [ ] **Step 3: Implement `resources/account.ts`**

Replace the stub from Task 2 with the real implementation, ported from `nodes/InfluticsAccount/InfluticsAccount.node.ts:78-110` (the `OPERATIONS` map only — `getUsage` and `getLimits`). Both handlers are no-param GETs, so the implementation is minimal.

```typescript
/**
 * Influtics Account resource (v1.1.0).
 *
 * Implementation choices:
 * - Two read-only operations: Get Usage + Get Limits. Both endpoints take no
 *   user input (no query params, no body) — there is nothing to guard against
 *   on the wire.
 * - Both endpoints cost 0 credits and are exempt from the paid-plan gate.
 * - Public docs: https://docs.influtics.com/
 *
 * Backend contract:
 *   GET /v1/account/usage  → 200 { success, data: { usage_history, summary } }
 *   GET /v1/account/limits → 200 { success, data: { rate_limits: { ... } } }
 *   Errors: 401 UNAUTHORIZED, 429 RATE_LIMITED.
 */
import {
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

export const ACCOUNT_OPERATIONS: Record<string, OperationHandler> = {
  getUsage: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/usage');
    return response as IDataObject;
  },
  getLimits: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/limits');
    return response as IDataObject;
  },
};

export function accountProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: ['account'] } },
      options: [
        {
          name: 'Get Limits',
          value: 'getLimits',
          description: 'Read rate limit configuration',
          action: 'Read rate limit configuration',
        },
        {
          name: 'Get Usage',
          value: 'getUsage',
          description: 'Read usage history and subscription summary',
          action: 'Read usage history and subscription summary',
        },
      ],
      default: 'getUsage',
    },
  ];
}
```

- [ ] **Step 4: Run the test, verify it passes**

```bash
npm test -- account.test.ts
```

Expected: 8 passing tests, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add nodes/Influtics/resources/account.ts __tests__/account.test.ts
git commit -m "feat(nodes): port InfluticsAccount → Influtics/resources/account"
```

---

### Task 6: Implement `resources/trend.ts` (TDD)

**Files:**
- Modify: `nodes/Influtics/resources/trend.ts`
- Create: `__tests__/trend.test.ts`

- [ ] **Step 1: Write the failing test**

Port `__tests__/InfluticsTrend.test.ts` verbatim. Pattern:
- Import: `import { TREND_OPERATIONS } from '../nodes/Influtics/resources/trend';`
- Each `executeInfluticsTrend.call(ctx, [{json:{}}])` → `TREND_OPERATIONS.search.call(ctx as any, 0)`
- Use shared `makeMockContext` with `resource: 'trend'` default

Expected test count: same as `__tests__/InfluticsTrend.test.ts` (20 tests across happy path / 400 validation errors / 401 / 402 / 429 / single-batch).

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- trend.test.ts
```

Expected: FAIL (TREND_OPERATIONS is empty stub).

- [ ] **Step 3: Implement `resources/trend.ts`**

Port from `nodes/InfluticsTrend/InfluticsTrend.node.ts:53-121`. Keep all 6 defensive guards (keyword required + trimmed, platform in VALID_PLATFORMS, REGION_REGEX, days in VALID_DAYS) and the cursor/region/days additionalFields collection. Map the file's `executeInfluticsTrend` pattern into `TREND_OPERATIONS.search` only.

The operation dropdown now has a `displayOptions: { show: { resource: ['trend'] } }` guard and the `additionalFields` collection keeps `operation: ['search']` only. Both guards compound: the canvas shows the Trend operation dropdown only when Resource=Trend, and shows `additionalFields` only when Trend + Search.

```typescript
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

const VALID_DAYS = ['0', '1', '7', '30', '90', '180'];
const VALID_PLATFORMS = ['tiktok', 'youtube'];
const REGION_REGEX = /^[A-Za-z]{2}$/;

export const TREND_OPERATIONS: Record<string, OperationHandler> = {
  search: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const keyword = this.getNodeParameter('keyword', _i, '') as string;
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const additionalFields = this.getNodeParameter(
      'additionalFields',
      _i,
      {} as { cursor?: string; region?: string; days?: string },
    ) as { cursor?: string; region?: string; days?: string };

    if (!keyword || !keyword.trim()) {
      throw new NodeOperationError(this.getNode(), 'Keyword is required');
    }
    if (!platform) {
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      throw new NodeOperationError(
        this.getNode(),
        `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
      );
    }
    if (additionalFields.region && !REGION_REGEX.test(additionalFields.region)) {
      throw new NodeOperationError(
        this.getNode(),
        'Region must be a two-letter ISO 3166-1 code (e.g. US, DE, JP)',
      );
    }
    if (additionalFields.days && !VALID_DAYS.includes(additionalFields.days)) {
      throw new NodeOperationError(
        this.getNode(),
        `Days must be one of: ${VALID_DAYS.join(', ')}`,
      );
    }

    const qs: IDataObject = { keyword: keyword.trim(), platform };
    if (additionalFields.cursor) qs.cursor = additionalFields.cursor;
    if (additionalFields.region) qs.region = additionalFields.region;
    if (additionalFields.days) qs.days = additionalFields.days;

    const response = await influticsApiRequest.call(
      this,
      'GET',
      '/v1/trends/search',
      undefined,
      qs,
    );
    return response as IDataObject;
  },
};

export function trendProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: ['trend'] } },
      options: [
        {
          name: 'Search',
          value: 'search',
          description: 'Search TikTok or YouTube trends by keyword',
          action: 'Search tiktok or youtube trends by keyword',
        },
      ],
      default: 'search',
    },
    {
      displayName: 'Keyword',
      name: 'keyword',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
      default: '',
      required: true,
      description: 'Keyword to search trends for (will be trimmed before sending)',
    },
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' },
        { name: 'YouTube', value: 'youtube' },
      ],
      default: 'tiktok',
      required: true,
      description: 'Platform to search trends on',
    },
    {
      displayName: 'Additional Options',
      name: 'additionalFields',
      type: 'collection',
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
      default: {},
      placeholder: 'Add Option',
      options: [
        {
          displayName: 'Cursor', name: 'cursor', type: 'string', default: '',
          description: 'Pagination cursor returned by a prior search call',
        },
        {
          displayName: 'Region', name: 'region', type: 'string', default: '',
          description: 'ISO 3166-1 alpha-2 country code (e.g. US, DE, JP)',
        },
        {
          displayName: 'Days', name: 'days', type: 'options',
          options: [
            { name: 'No Window', value: '0' },
            { name: '1 Day', value: '1' },
            { name: '7 Days', value: '7' },
            { name: '30 Days', value: '30' },
            { name: '90 Days', value: '90' },
            { name: '180 Days', value: '180' },
          ],
          default: '0',
          description: 'Time window for the trend search (0 = no window)',
        },
      ],
    },
  ];
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- trend.test.ts
```

Expected: 20 (trend) / 23 (video) passing tests, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add nodes/Influtics/resources/trend.ts __tests__/trend.test.ts
git commit -m "feat(nodes): port InfluticsTrend → Influtics/resources/trend"
```

---

### Task 7: Implement `resources/blogger.ts` (TDD)

**Files:**
- Modify: `nodes/Influtics/resources/blogger.ts`
- Create: `__tests__/blogger.test.ts`

- [ ] **Step 1: Write the failing test**

Port `__tests__/InfluticsBlogger.test.ts` verbatim. Pattern:
- Import: `import { BLOGGER_OPERATIONS } from '../nodes/Influtics/resources/blogger';`
- Replace each executor call with `BLOGGER_OPERATIONS.<op>.call(ctx as any, 0)` — 3 ops (track / getJob / byUsername)
- Use shared `makeMockContext` with `resource: 'blogger'` default

Expected test count: ~17 tests across happy path / 400 / 401 / 402 / 409 / 422 / 410 / 404 / single-batch.

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- blogger.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `resources/blogger.ts`**

Port from `nodes/InfluticsBlogger/InfluticsBlogger.node.ts:66-156`. Three handlers:
- `track` — coerces + clamps `initial_videos_count` to [1..500], fail-fast on platform/username/empty integer
- `getJob` — fail-fast on empty jobId
- `byUsername` — fail-fast on empty username, strips empty platform from qs

Properties: Operation dropdown scoped to `resource: ['blogger']`. Each parameter guards with `resource + operation` compound.

```typescript
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

const INITIAL_VIDEOS_MIN = 1;
const INITIAL_VIDEOS_MAX = 500;

export const BLOGGER_OPERATIONS: Record<string, OperationHandler> = {
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const username = this.getNodeParameter('username', _i, '') as string;
    const initialVideosCountRaw = this.getNodeParameter('initialVideosCount', _i, '');

    if (!platform) throw new NodeOperationError(this.getNode(), 'Platform is required');
    if (!username) throw new NodeOperationError(this.getNode(), 'Username is required');

    const initialVideosCount = Number(initialVideosCountRaw);
    if (
      initialVideosCountRaw === '' ||
      initialVideosCountRaw === null ||
      initialVideosCountRaw === undefined ||
      !Number.isFinite(initialVideosCount) ||
      !Number.isInteger(initialVideosCount)
    ) {
      throw new NodeOperationError(
        this.getNode(),
        'initial_videos_count is required and must be an integer between 1 and 500',
      );
    }
    const initialVideosCountClamped = Math.max(
      INITIAL_VIDEOS_MIN,
      Math.min(initialVideosCount, INITIAL_VIDEOS_MAX),
    );

    const response = await influticsApiRequest.call(
      this,
      'POST',
      '/v1/bloggers/track',
      { platform, username, initial_videos_count: initialVideosCountClamped } as IDataObject,
    );
    return response as IDataObject;
  },
  getJob: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const jobId = this.getNodeParameter('jobId', _i, '') as string;
    if (!jobId) throw new NodeOperationError(this.getNode(), 'Job ID is required');
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/bloggers/jobs/${encodeURIComponent(jobId)}`,
    );
    return response as IDataObject;
  },
  byUsername: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const username = this.getNodeParameter('username', _i, '') as string;
    if (!username) throw new NodeOperationError(this.getNode(), 'Username is required');
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const qs: IDataObject = {};
    if (platform) qs.platform = platform;
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/bloggers/by-username/${encodeURIComponent(username)}`,
      undefined,
      Object.keys(qs).length > 0 ? qs : undefined,
    );
    return response as IDataObject;
  },
};

export function bloggerProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: ['blogger'] } },
      options: [
        {
          name: 'By Username', value: 'byUsername',
          description: 'Read a tracked creator by platform + username (read-only)',
          action: 'Read a tracked creator by platform + username',
        },
        {
          name: 'Get Job', value: 'getJob',
          description: 'Poll the status of a track-creator job by ID',
          action: 'Poll the status of a track creator job by id',
        },
        {
          name: 'Track', value: 'track',
          description: 'Start tracking a creator (async — returns job_id to poll)',
          action: 'Start tracking a creator',
        },
      ],
      default: 'track',
    },
    {
      displayName: 'Platform', name: 'platform', type: 'options',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' }, { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' }, { name: 'VK', value: 'vk' },
      ],
      default: 'tiktok', required: true,
      description: 'Platform to track the creator on',
    },
    {
      displayName: 'Username', name: 'username', type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      default: '', required: true,
      description: 'Creator username without the leading @ (max 64 chars)',
    },
    {
      displayName: 'Initial Videos Count', name: 'initialVideosCount', type: 'number',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      typeOptions: { minValue: 1, maxValue: 500 },
      default: 10, required: true,
      description: 'Number of initial videos to backfill (1–500). Default: 10. Backend clamps to 500.',
    },
    {
      displayName: 'Job ID', name: 'jobId', type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['getJob'] } },
      default: '', required: true,
      description: 'Job UUID returned by the Track operation',
    },
    {
      displayName: 'Username', name: 'username', type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['byUsername'] } },
      default: '', required: true,
      description: 'Creator username (with or without leading @)',
    },
    {
      displayName: 'Platform', name: 'platform', type: 'options',
      displayOptions: { show: { resource: ['blogger'], operation: ['byUsername'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' }, { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' }, { name: 'VK', value: 'vk' },
      ],
      default: 'tiktok', required: true,
      description: 'Platform the creator is on (defaults to tiktok server-side)',
    },
  ];
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- blogger.test.ts
```

Expected: ~17 passing tests, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add nodes/Influtics/resources/blogger.ts __tests__/blogger.test.ts
git commit -m "feat(nodes): port InfluticsBlogger → Influtics/resources/blogger"
```

---

### Task 8: Implement `resources/video.ts` (TDD)

**Files:**
- Modify: `nodes/Influtics/resources/video.ts`
- Create: `__tests__/video.test.ts`

- [ ] **Step 1: Write the failing test**

Port `__tests__/InfluticsVideo.test.ts` verbatim. Pattern:
- Import: `import { VIDEO_OPERATIONS } from '../nodes/Influtics/resources/video';`
- Replace each executor call with `VIDEO_OPERATIONS.<op>.call(ctx as any, 0)` — 5 ops (track / getStats / getById / getByExternalId / updateByExternalId)
- Use shared `makeMockContext` with `resource: 'video'` default

Expected test count: same as `__tests__/InfluticsVideo.test.ts` (~23 tests).

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- video.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `resources/video.ts`**

Port from `nodes/InfluticsVideo/InfluticsVideo.node.ts:38-233`. Five handlers with full defensive guards:
- `track` — fail-fast on empty urls
- `getStats` — `PAGINATION_MAX_PAGES=50` cursor walk, hard cap `limit` at 100, returns `{ data: [...] }` on returnAll
- `getById` — fail-fast on empty id, URL-encoded
- `getByExternalId` — fail-fast on empty externalId + empty platform (UI marks platform required), URL-encoded
- `updateByExternalId` — fail-fast on empty externalId/empty platform/empty body, only includes non-empty fields in body, URL-encoded

Properties are scoped via `resource: ['video']` + `operation: [...]` compound guards. The Operation dropdown is alphabetized per `node-param-options-type-unsorted-items`.

```typescript
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

const PAGINATION_MAX_PAGES = 50;

export const VIDEO_OPERATIONS: Record<string, OperationHandler> = {
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const urlsParam = this.getNodeParameter('urls', _i) as { urls: string[] };
    if (!Array.isArray(urlsParam.urls) || urlsParam.urls.length === 0) {
      throw new NodeOperationError(this.getNode(), 'Provide at least one video URL');
    }
    const response = await influticsApiRequest.call(
      this, 'POST', '/v1/videos/track', { urls: urlsParam.urls } as IDataObject,
    );
    return response as IDataObject;
  },
  getStats: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const platform = this.getNodeParameter('platform', i, '') as string;
    const status = this.getNodeParameter('status', i, '') as string;
    const bloggerUsername = this.getNodeParameter('blogger_username', i, '') as string;
    const sort = this.getNodeParameter('sort', i, '') as string;
    const order = this.getNodeParameter('order', i, '') as string;
    const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
    const limitRaw = this.getNodeParameter('limit', i, 50) as unknown;
    const limitRawNum = typeof limitRaw === 'number' && limitRaw > 0 ? limitRaw : 50;
    const limit = Math.min(limitRawNum, 100);

    const baseQs: IDataObject = {};
    if (platform) baseQs.platform = platform;
    if (status) baseQs.status = status;
    if (bloggerUsername) baseQs.blogger_username = bloggerUsername;
    if (sort) baseQs.sort = sort;
    if (order) baseQs.order = order;
    if (!returnAll) baseQs.limit = limit;

    if (returnAll) {
      const collected: IDataObject[] = [];
      const pageSize = typeof limit === 'number' && limit > 0 ? limit : 50;
      let offset = 0;
      for (let page = 0; page < PAGINATION_MAX_PAGES; page++) {
        const pageQs: IDataObject = { ...baseQs, limit: pageSize, offset };
        const response = await influticsApiRequest.call(
          this, 'GET', '/v1/videos/stats', undefined, pageQs,
        );
        const items: unknown[] = Array.isArray((response as any)?.data?.data)
          ? ((response as any).data.data as unknown[])
          : Array.isArray((response as any)?.data)
            ? ((response as any).data as unknown[])
            : [];
        for (const item of items) {
          if (item && typeof item === 'object') collected.push(item as IDataObject);
        }
        const pagination = (response as any)?.data?.pagination;
        const hasMore = !!pagination?.has_more;
        if (!hasMore) break;
        offset += pageSize;
      }
      return { data: collected } as IDataObject;
    }

    return (await influticsApiRequest.call(
      this, 'GET', '/v1/videos/stats', undefined, baseQs,
    )) as IDataObject;
  },
  getById: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const id = this.getNodeParameter('id', i, '') as string;
    if (!id) throw new NodeOperationError(this.getNode(), 'Video ID is required');
    const response = await influticsApiRequest.call(
      this, 'GET', `/v1/videos/by-id/${encodeURIComponent(id)}`,
    );
    return response as IDataObject;
  },
  getByExternalId: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const externalId = this.getNodeParameter('externalId', i, '') as string;
    if (!externalId) throw new NodeOperationError(this.getNode(), 'External ID is required');
    const platform = this.getNodeParameter('platform', i, '') as string;
    if (!platform) throw new NodeOperationError(this.getNode(), 'Platform is required');
    const response = await influticsApiRequest.call(
      this, 'GET', `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`,
    );
    return response as IDataObject;
  },
  updateByExternalId: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const externalId = this.getNodeParameter('externalId', i, '') as string;
    if (!externalId) throw new NodeOperationError(this.getNode(), 'External ID is required');
    const platform = this.getNodeParameter('platform', i, '') as string;
    if (!platform) throw new NodeOperationError(this.getNode(), 'Platform is required');
    const updateFields = this.getNodeParameter(
      'updateFields', i,
      {} as { notes?: string; campaign?: string; status?: string; tags?: string[] },
    ) as { notes?: string; campaign?: string; status?: string; tags?: string[] };

    const body: IDataObject = {};
    if (typeof updateFields.notes === 'string' && updateFields.notes.length > 0) body.notes = updateFields.notes;
    if (typeof updateFields.campaign === 'string' && updateFields.campaign.length > 0) body.campaign = updateFields.campaign;
    if (typeof updateFields.status === 'string' && updateFields.status.length > 0) body.status = updateFields.status;
    if (Array.isArray(updateFields.tags) && updateFields.tags.length > 0) body.tags = updateFields.tags;
    if (Object.keys(body).length === 0) {
      throw new NodeOperationError(
        this.getNode(),
        'Provide at least one update field (notes, campaign, status, or tags)',
      );
    }
    const response = await influticsApiRequest.call(
      this, 'PATCH', `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`, body,
    );
    return response as IDataObject;
  },
};

export function videoProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
      displayOptions: { show: { resource: ['video'] } },
      options: [
        { name: 'Get By External ID', value: 'getByExternalId',
          description: 'Read one tracked video by platform + external ID',
          action: 'Read one tracked video by platform + external ID' },
        { name: 'Get By ID', value: 'getById',
          description: 'Read one tracked video by internal ID',
          action: 'Read one tracked video by internal ID' },
        { name: 'Get Stats', value: 'getStats',
          description: 'Read video-level metrics',
          action: 'Read video level metrics' },
        { name: 'Track', value: 'track',
          description: 'Track videos by URL',
          action: 'Track videos by URL' },
        { name: 'Update By External ID', value: 'updateByExternalId',
          description: 'Patch metadata on a tracked video',
          action: 'Patch metadata on a tracked video' },
      ],
      default: 'track',
    },
    {
      displayName: 'URLs', name: 'urls', type: 'collection',
      displayOptions: { show: { resource: ['video'], operation: ['track'] } },
      default: {},
      options: [
        { displayName: 'URLs', name: 'urls', type: 'string',
          typeOptions: { multipleValues: true }, default: [],
          description: 'Up to 50 video URLs to track' },
      ],
    },
    {
      displayName: 'Return All', name: 'returnAll', type: 'boolean',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: false,
      description: 'Whether to return all results or only up to a given limit',
    },
    {
      displayName: 'Limit', name: 'limit', type: 'number',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'], returnAll: [false] } },
      typeOptions: { minValue: 1 }, default: 50,
      description: 'Max number of results to return',
    },
    {
      displayName: 'Platform', name: 'platform', type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' }, { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' }, { name: 'VK', value: 'vk' },
      ],
      default: 'tiktok',
      description: 'Filter by a single platform',
    },
    {
      displayName: 'Status', name: 'status', type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      options: [
        { name: 'Active', value: 'active' },
        { name: 'Completed', value: 'completed' },
        { name: 'Failed', value: 'failed' },
      ],
      default: 'active',
      description: 'Filter by tracking status',
    },
    {
      displayName: 'Blogger Username', name: 'blogger_username', type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: '',
      description: 'Filter by a single blogger username',
    },
    {
      displayName: 'Sort', name: 'sort', type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: 'created_at',
      description: 'Field to sort by. Allowed: created_at, views, likes, updated_at. Default: created_at',
    },
    {
      displayName: 'Order', name: 'order', type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      options: [
        { name: 'Ascending', value: 'asc' }, { name: 'Descending', value: 'desc' },
      ],
      default: 'desc',
      description: 'Sort order',
    },
    {
      displayName: 'Video ID', name: 'id', type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getById'] } },
      default: '', required: true,
    },
    {
      displayName: 'External ID', name: 'externalId', type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getByExternalId', 'updateByExternalId'] } },
      default: '', required: true,
      description: 'The platform-specific video ID (e.g. TikTok video ID)',
    },
    {
      displayName: 'Platform', name: 'platform', type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getByExternalId', 'updateByExternalId'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' }, { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' }, { name: 'VK', value: 'vk' },
      ],
      default: 'tiktok', required: true,
    },
    {
      displayName: 'Update Fields', name: 'updateFields', type: 'collection',
      displayOptions: { show: { resource: ['video'], operation: ['updateByExternalId'] } },
      default: {},
      options: [
        { displayName: 'Notes', name: 'notes', type: 'string', default: '' },
        { displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
        {
          displayName: 'Status', name: 'status', type: 'options',
          options: [
            { name: 'No Change', value: '' },
            { name: 'To Do', value: 'to do' },
            { name: 'Running', value: 'running' },
            { name: 'Ended', value: 'ended' },
          ],
          default: '',
        },
        {
          displayName: 'Tags', name: 'tags', type: 'string',
          typeOptions: { multipleValues: true }, default: [],
          description: 'Tag names to attach (existing tags are preserved)',
        },
      ],
    },
  ];
}
```

- [ ] **Step 4: Run, verify pass**

```bash
npm test -- video.test.ts
```

Expected: 20 (trend) / 23 (video) passing tests, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add nodes/Influtics/resources/video.ts __tests__/video.test.ts
git commit -m "feat(nodes): port InfluticsVideo → Influtics/resources/video"
```

---

## Phase 3 — Dispatcher integration tests

### Task 9: Write dispatcher routing smoke tests

**Files:**
- Create: `__tests__/dispatcher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * Tier 2 dispatcher integration smoke tests.
 *
 * Per-resource handler tests (account/blogger/trend/video.test.ts) cover the
 * per-operation wire contract in isolation. This file proves the dispatcher
 * itself routes every (resource, operation) pair to the right handler and
 * throws `NodeOperationError` on unknown values.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import nock from 'nock';
import { NodeOperationError } from 'n8n-workflow';
import { executeInflutics } from '../nodes/Influtics/Influtics.node';
import { BASE_URL, makeMockContext } from './helpers/mockContext';

const ROUTES: Array<{ resource: string; operation: string; method: 'GET' | 'POST' | 'PATCH'; path: string }> = [
  { resource: 'video',   operation: 'track',             method: 'POST', path: '/v1/videos/track' },
  { resource: 'video',   operation: 'getStats',          method: 'GET',  path: '/v1/videos/stats' },
  { resource: 'video',   operation: 'getById',           method: 'GET',  path: '/v1/videos/by-id/abc-123' },
  { resource: 'video',   operation: 'getByExternalId',   method: 'GET',  path: '/v1/videos/by-external-id/ext-1' },
  { resource: 'video',   operation: 'updateByExternalId',method: 'PATCH',path: '/v1/videos/by-external-id/ext-1' },
  { resource: 'blogger', operation: 'track',             method: 'POST', path: '/v1/bloggers/track' },
  { resource: 'blogger', operation: 'getJob',            method: 'GET',  path: '/v1/bloggers/jobs/job-1' },
  { resource: 'blogger', operation: 'byUsername',        method: 'GET',  path: '/v1/bloggers/by-username/handle' },
  { resource: 'trend',   operation: 'search',            method: 'GET',  path: '/v1/trends/search' },
  { resource: 'account', operation: 'getUsage',          method: 'GET',  path: '/v1/account/usage' },
  { resource: 'account', operation: 'getLimits',         method: 'GET',  path: '/v1/account/limits' },
];

describe('executeInflutics dispatcher — routing', () => {
  beforeAll(() => { nock.disableNetConnect(); });
  afterEach(() => { nock.cleanAll(); nock.enableNetConnect(); });

  it.each(ROUTES)('%s.%s routes to its handler', async (route) => {
    // Provide the minimum params each operation needs so the handler doesn't
    // fail-fast before hitting the wire.
    const params: Record<string, unknown> = {
      resource: route.resource,
      operation: route.operation,
      // Trend search
      keyword: 'foo', platform: 'tiktok',
      // Video track
      urls: { urls: ['https://tiktok.com/@x/video/1'] },
      // Video getById
      id: 'abc-123',
      // Video getByExternalId / updateByExternalId
      externalId: 'ext-1', platform: 'tiktok',
      updateFields: { notes: 'x' },
      // Blogger track
      username: 'handle', initialVideosCount: 10,
      // Blogger getJob
      jobId: 'job-1',
    };
    const ctx = makeMockContext(params);
    nock(BASE_URL)[route.method.toLowerCase() as 'get'](route.path).reply(200, { ok: true });

    const out = await executeInflutics.call(ctx as any, [{ json: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].json).toBeDefined();
  });

  it('throws NodeOperationError on unknown resource', async () => {
    const ctx = makeMockContext({ resource: 'unknown', operation: 'foo' });
    await expect(executeInflutics.call(ctx as any, [{ json: {} }])).rejects.toThrow(NodeOperationError);
  });

  it('throws NodeOperationError on unknown operation', async () => {
    const ctx = makeMockContext({ resource: 'video', operation: 'bogus' });
    await expect(executeInflutics.call(ctx as any, [{ json: {} }])).rejects.toThrow(NodeOperationError);
  });

  it('dispatches a single batch — one HTTP call per run regardless of input items', async () => {
    // Guards against silent drift where the dispatcher loops over input items.
    const ctx = makeMockContext({ resource: 'account', operation: 'getUsage' });
    nock(BASE_URL).get('/v1/account/usage').reply(200, { success: true, data: {} });
    const items = [{ json: {} }, { json: {} }, { json: {} }];
    await executeInflutics.call(ctx as any, items);
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run, verify fail**

```bash
npm test -- dispatcher.test.ts
```

Expected: FAIL (the dispatcher import will succeed but the routing assertions may surface handler-side issues — fix per test, not by changing the production code).

- [ ] **Step 3: Run full test suite to confirm everything co-exists**

```bash
npm test
```

Expected: all per-resource tests + dispatcher tests pass. The four old `__tests__/Influtics*.test.ts` files should still pass too (they hit the old node classes; the new node co-exists with them in `n8n.nodes`).

- [ ] **Step 4: Run lint**

```bash
npm run lint
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add __tests__/dispatcher.test.ts
git commit -m "test(dispatcher): routing smoke tests for all 11 (resource, operation) pairs"
```

---

## Phase 4 — Manifest + index + docs

### Task 10: Update `index.ts` to export only `Influtics`

**Files:**
- Modify: `index.ts`

- [ ] **Step 1: Replace the four old exports with the single new one**

```typescript
/**
 * Package entry point.
 *
 * Re-exports the single Influtics action node + credential so
 * `import 'n8n-nodes-influtics'` (the value `package.json: "main"` resolves
 * to) gives consumers the full surface in one named-import namespace. n8n's
 * community-node loader reads `main` to discover the package; without this
 * file `dist/index.js` is missing and the loader surfaces a parse error.
 *
 * Per the official `@n8n/node-cli` template (`npx n8n-node new`).
 */

export { InfluticsApi } from './credentials/InfluticsApi.credentials';
export { Influtics } from './nodes/Influtics/Influtics.node';
```

- [ ] **Step 2: Verify TS compiles**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Verify build still succeeds with both manifest entries**

```bash
npm run build
```

Expected: `dist/nodes/Influtics/Influtics.node.js` plus the four legacy `dist/nodes/Influtics*/Influtics*.node.js` files.

- [ ] **Step 4: Commit**

```bash
git add index.ts
git commit -m "feat(manifest): export single Influtics node from index.ts (legacy exports dropped)"
```

---

### Task 11: Bump version + add `single-action-node` keyword in `package.json`

**Files:**
- Modify: `package.json` (line 3 — version; `keywords` array currently spans lines 10–16)

- [ ] **Step 1: Apply the diff**

```diff
-  "version": "1.0.10",
+  "version": "1.1.0",
```

```diff
   "keywords": [
     "n8n",
     "n8n-community-node",
     "n8n-community-node-package",
     "n8ncommunity",
     "influtics",
-    "influencer-marketing"
+    "influencer-marketing",
+    "single-action-node"
   ],
```

- [ ] **Step 2: Verify build still succeeds**

```bash
npm run build
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "feat(release): bump to 1.1.0 + 'single-action-node' keyword"
```

---

### Task 12: Add `CHANGELOG.md` v1.1.0 entry

**Files:**
- Modify: `CHANGELOG.md` (prepend a new entry at the top)

- [ ] **Step 1: Prepend the BREAKING entry above the existing v1.0.10 entry**

```markdown
## [1.1.0] - 2026-08-31

### ⚠️ BREAKING — package consolidated to a single action node

The four separate nodes (`Influtics Account`, `Influtics Blogger`, `Influtics Trend`,
`Influtics Video`) have been merged into a single **`Influtics`** action node, with each
surface exposed as a **Resource** (Account / Blogger / Trend / Video) and each operation
under it.

This change is required by [n8n's verified-nodes guidelines][vg] ("one regular node per
package") and follows the pattern used by HubSpot, Notion, Airtable, etc.

[vg]: https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines#node-types

#### Action required for existing workflows

**Workflows that reference the old node types will fail to load after upgrading.** n8n
does not auto-rename community-node types, so each affected node must be re-created:

1. Open the workflow in the n8n canvas.
2. Delete the old node (e.g. `Influtics Video`).
3. Drop a new `Influtics` node onto the canvas and re-wire it.
4. Pick the matching **Resource** (Video / Blogger / Trend / Account) + the same
   **Operation** as before.
5. Save the workflow.

Parameter names and operation values are unchanged — once the new node is dropped and the
old one deleted, all parameters are recognisable.

#### Other changes
- Node icon and credential unchanged.
- All backend endpoints, request bodies, and rate limits unchanged.
- ESLint-clean, vitest green, `n8n-node build` produces a 1-node `dist/`.
- `@n8n/scan-community-package` passes locally.

```

- [ ] **Step 2: Verify the date placeholder is replaced**

The date is `2026-08-31` (today, per `currentDate` context).

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): v1.1.0 BREAKING — single action node consolidation"
```

---

### Task 13: Update `README.md` (upgrade callout + four operations tables + troubleshooting)

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add upgrade callout to the Operations section**

Find the existing `## Operations` heading. Insert the callout immediately after the section heading and before any existing tables:

```markdown
> **Heads-up if you're upgrading from ≤ 1.0.10:** the four legacy nodes
> (`Influtics Video`, `Influtics Blogger`, `Influtics Trend`, `Influtics Account`)
> have been merged into a single **`Influtics`** node. Each surface is now a
> **Resource** dropdown. Workflows referencing the old node types must be
> re-created — see [CHANGELOG → 1.1.0](./CHANGELOG.md) for steps.
```

- [ ] **Step 2: Replace any existing operations tables with four resource-specific tables**

If the existing `## Operations` section has a single table or one table per old node, restructure into four tables under the callout:

```markdown
### Account

| Operation   | Description                                    |
|-------------|------------------------------------------------|
| Get Limits  | Read rate limit configuration                  |
| Get Usage   | Read usage history and subscription summary    |

### Blogger

| Operation   | Description                                                       |
|-------------|-------------------------------------------------------------------|
| By Username | Read a tracked creator by platform + username (read-only)         |
| Get Job     | Poll the status of a track-creator job by ID                      |
| Track       | Start tracking a creator (async — returns `job_id` to poll)       |

### Trend

| Operation | Description                                          |
|-----------|------------------------------------------------------|
| Search    | Search TikTok or YouTube trends by keyword           |

### Video

| Operation             | Description                                                 |
|-----------------------|-------------------------------------------------------------|
| Get By External ID    | Read one tracked video by platform + external ID            |
| Get By ID             | Read one tracked video by internal ID                       |
| Get Stats             | Read video-level metrics                                    |
| Track                 | Track videos by URL                                         |
| Update By External ID | Patch metadata on a tracked video                           |
```

- [ ] **Step 3: Add `### Upgrading from ≤ 1.0.10` to the `## Troubleshooting` section**

```markdown
### Upgrading from ≤ 1.0.10

**Symptom:** After installing v1.1.0, an existing workflow errors with
`Node type influticsVideo is not known`. (The exact type name appears in the
error toast on the failing node.)

**Cause:** v1.1.0 merges the four legacy nodes into a single `Influtics` action
node. n8n does not auto-rename community-node types.

**Fix:** Delete the old node from the canvas and drop a new `Influtics` node.
Pick the matching **Resource** (Video / Blogger / Trend / Account) and the same
**Operation** you had before. All parameter names and types are unchanged.
```

- [ ] **Step 4: Verify the rendered structure**

```bash
grep -nE "^##|^###" README.md
```

Expected: the existing `## Operations` + four `### <Resource>` subheadings + a new `### Upgrading from ≤ 1.0.10` under `## Troubleshooting`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs(readme): v1.1.0 upgrade callout + per-resource operations tables + troubleshooting"
```

---

## Phase 5 — Pre-publish gate

### Task 14: Full lint + test + build + scan

**Files:** none (verification only)

- [ ] **Step 1: Lint**

```bash
npm run lint
```

Expected: 0 errors. If any `eslint-disable-next-line` is reported, inspect: the comments carried over from the legacy nodes must remain attached to the `inputs:` and `outputs:` lines in `Influtics.node.ts`.

- [ ] **Step 2: Tests**

```bash
npm test
```

Expected: all per-resource tests + dispatcher tests + `GenericFunctions.test.ts` pass. Roughly:
- `account.test.ts`: 8
- `blogger.test.ts`: 17
- `trend.test.ts`: 20
- `video.test.ts`: 23
- `dispatcher.test.ts`: 14 (11 routes + 2 throws + 1 single-batch)
- `GenericFunctions.test.ts`: 6
- **Plus the four legacy `Influtics*.test.ts` files: 68** (8 + 17 + 20 + 23 — still passing — they hit the legacy node classes which still exist on disk)

Total: 156 tests passing.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: 0 errors. `dist/nodes/Influtics/Influtics.node.js` + four legacy `dist/nodes/Influtics*/Influtics*.node.js` files.

- [ ] **Step 4: Community package scan**

```bash
npm run scan:package
```

Expected: 0 errors. If the scanner flags the new single node, debug per the scanner output. Common issues:
- Missing icon: confirm `influtics-light.svg` + `influtics-dark.svg` exist in `nodes/Influtics/`
- Old node version: confirm `version: 2` in `Influtics.node.ts`

- [ ] **Step 5: Capture the green log for the commit message**

Save the scan output for the release commit body:

```bash
npm run scan:package 2>&1 | tee /tmp/scan-v1.1.0.log
```

### Task 15: Delete old node folders + old test files

**Files:**
- Delete: `nodes/InfluticsAccount/`, `nodes/InfluticsBlogger/`, `nodes/InfluticsTrend/`, `nodes/InfluticsVideo/` (16 files)
- Delete: `__tests__/InfluticsAccount.test.ts`, `__tests__/InfluticsBlogger.test.ts`, `__tests__/InfluticsTrend.test.ts`, `__tests__/InfluticsVideo.test.ts` (4 files)

- [ ] **Step 1: Verify all tests still pass before deletion**

```bash
npm test 2>&1 | tail -20
```

Expected: green. If any legacy test fails, do NOT proceed with deletion — investigate first.

- [ ] **Step 2: Delete legacy node folders + tests**

```bash
rm -rf nodes/InfluticsAccount
rm -rf nodes/InfluticsBlogger
rm -rf nodes/InfluticsTrend
rm -rf nodes/InfluticsVideo
rm -f  __tests__/InfluticsAccount.test.ts
rm -f  __tests__/InfluticsBlogger.test.ts
rm -f  __tests__/InfluticsTrend.test.ts
rm -f  __tests__/InfluticsVideo.test.ts
```

- [ ] **Step 3: Reduce `n8n.nodes` array to a single entry**

Edit `package.json` so the array reads:

```json
"nodes": [
  "dist/nodes/Influtics/Influtics.node.js"
]
```

- [ ] **Step 4: Verify the repo no longer references the legacy nodes**

```bash
grep -rn "InfluticsAccount\|InfluticsBlogger\|InfluticsTrend\|InfluticsVideo" nodes/ credentials/ index.ts package.json __tests__/ 2>&1 | head -20
```

Expected: 0 hits. If anything shows up, fix it before proceeding.

- [ ] **Step 5: Re-run lint + tests + build + scan to confirm the slim shape is green**

```bash
npm run lint && npm test && npm run build && npm run scan:package
```

Expected: 0 errors across all four commands. Test count drops to ~88 (no more 68 legacy tests; 8 + 17 + 20 + 23 + 14 dispatcher + 6 generic).

- [ ] **Step 6: Commit**

```bash
git add -A
git status
git commit -m "feat(release): drop legacy InfluticsAccount/Blogger/Trend/Video nodes + tests"
```

Expected `git status`: clean. `git log --oneline -5`: this commit is on top of Phase 4's commits.

---

## Phase 6 — Release

**Precondition:** `feat/single-action-node` has been merged to `main` via PR. Tag-push is gated to `main` because the release workflow's `on.push.tags: ['v*']` runs whatever branch the tag is on, and tag pushes from a feature branch can race with subsequent merges.

### Task 16: Open PR + merge

**Files:** none (git/PR workflow)

- [ ] **Step 1: Push the branch**

```bash
git push origin feat/single-action-node
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --base main --head feat/single-action-node \
  --title "feat: consolidate to single Influtics action node (v1.1.0)" \
  --body "Resolves n8n verification HIGH-severity feedback: 'Multiple regular nodes in a single package'. One Influtics action node, four resources (Account / Blogger / Trend / Video), 11 operations. Zero backend changes. CHANGELOG v1.1.0 carries the BREAKING note + migration steps."
```

- [ ] **Step 3: Resolve any merge conflicts**

If the PR is not `mergeable`, follow the rules in `feedback_always-resolve-conflicts.md` — check `mergeable` immediately after `gh pr create`.

- [ ] **Step 4: Merge + verify state**

```bash
gh pr view --json state,mergeable
# if still open and mergeable: gh pr merge --squash --delete-branch
# verify post-merge:
git fetch origin main && git checkout main && git pull && git log --oneline -3
git branch --show-current   # should print: main
```

Expected: PR merged, branch deleted, local `main` is at the merge commit.

### Task 17: Tag v1.1.0 + push (triggers CI publish)

**Files:** none (git workflow)

- [ ] **Step 1: Verify on main, working tree clean**

```bash
git branch --show-current    # main
git status                   # clean
git log --oneline -1         # the squash commit from PR merge
```

- [ ] **Step 2: Tag and push**

```bash
git tag -a v1.1.0 -m "v1.1.0"
git push origin v1.1.0
```

This triggers `.github/workflows/release.yml` which runs `npm publish --provenance --access public`.

- [ ] **Step 3: Monitor the release workflow**

```bash
gh run watch --workflow=release.yml --exit-status
```

Expected: workflow completes successfully. The `release.yml` runs `npm run lint && npm run build && npm test` before publish, so this is the canonical gate.

- [ ] **Step 4: Verify the publish**

```bash
npm view n8n-nodes-influtics@1.1.0 dist.provenance
npm view n8n-nodes-influtics versions --json | tail -5
```

Expected: v1.1.0 is the latest version. `dist.provenance` printed (the npm registry confirmed the OIDC provenance attestation).

### Task 18: Reply to n8n verification team

**Files:** none (email + creators portal reply)

- [ ] **Step 1: Reply to the original ticket/email**

Send the message from `design.md` §7.4 (the verification team reply template). The dist.provenance URL is the link to the npm registry's provenance page for v1.1.0.

- [ ] **Step 2: Update the creators portal submission**

If the original submission was via https://creators.n8n.io/nodes (per `feedback_n8n-creator-portal-submission-url.md`), post a follow-up comment on the submission thread linking to v1.1.0.

---

## Summary

| Phase | Tasks | Outcome |
|-------|-------|---------|
| 1 — Scaffold | 1, 2, 3 | Empty single-node scaffold co-exists with legacy nodes; tests still green |
| 2 — Resource modules | 4, 5, 6, 7, 8 | Each resource ported TDD; full per-resource test coverage preserved |
| 3 — Dispatcher | 9 | Tier-2 smoke tests prove routing for all 11 ops |
| 4 — Manifest + docs | 10, 11, 12, 13 | package.json, index.ts, CHANGELOG, README ready for release |
| 5 — Pre-publish gate | 14, 15 | Lint + tests + build + scan all green; legacy nodes deleted |
| 6 — Release | 16, 17, 18 | PR merged, tag v1.1.0 pushed, CI publishes with provenance, n8n team notified |

**Total estimated commits:** 16 (matches the 16 individual commits the task list walks through).

**Total estimated file footprint:**
- ~1,177 LOC node source deleted; ~945 LOC new node source created (glue + dispatcher + 4 resource modules — modest reduction from per-node headers/comments)
- ~2,236 LOC test source deleted; ~2,420 LOC new test source created (similar + dispatcher tests + shared helper)
- Net change: ~+50 LOC of source, ~+180 LOC of tests

**Backwards compatibility:** zero. This is the documented breaking change in CHANGELOG v1.1.0. Existing workflows must be re-created by hand.

---

## Out of scope for v1.1.0

Per design §8, the following are deliberately NOT in this plan:
- ❌ Adding a trigger node (`Influtics Trigger` for new-trend / new-video webhooks)
- ❌ Adding `n8n-nodes-base` parity features
- ❌ Renaming or re-grouping operations
- ❌ Touching the `InfluticsApi` credential

These are tracked as follow-up work, not blockers for the n8n verification re-review.
