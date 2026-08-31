# Consolidate `n8n-nodes-influtics` to a single action node — Design

**Status:** Draft, pending user review.
**Target release:** v1.1.0
**Branch:** `feat/single-action-node`
**Tracking:** n8n verified-nodes team feedback — `[HIGH] Multiple regular nodes in a single package`.

---

## 1. Context

The n8n verified-nodes team flagged the four separately-registered node types
(`Influtics Account`, `Influtics Blogger`, `Influtics Trend`, `Influtics Video`)
as violating the "one regular node per package" guideline. The fix is the
pattern used by verified nodes such as HubSpot, Notion, and Airtable: a single
action node with each surface exposed as a **Resource**.

This design collapses the four nodes into one `Influtics` action node while
preserving every existing wire contract (zero backend changes), every
operation's name/default/parameters, and every test case. The result is a
breaking-change release at **v1.1.0** with a clear migration story in
`CHANGELOG.md`.

---

## 2. Architecture

### 2.1 Physical layout

```
nodes/
├── GenericFunctions.ts                  (UNCHANGED — shared by all resources)
├── Influtics/
│   ├── Influtics.node.ts                ← glue: dispatcher + INodeTypeDescription
│   └── resources/
│       ├── account.ts                   ← ACCOUNT_OPERATIONS + accountProperties()
│       ├── blogger.ts                   ← BLOGGER_OPERATIONS + bloggerProperties()
│       ├── trend.ts                     ← TREND_OPERATIONS   + trendProperties()
│       └── video.ts                     ← VIDEO_OPERATIONS   + videoProperties()
└── (InfluticsAccount/, InfluticsBlogger/, InfluticsTrend/, InfluticsVideo/   DELETED)

__tests__/
├── GenericFunctions.test.ts             (UNCHANGED)
├── dispatcher.test.ts                   (NEW — ~80 LOC, integration smoke tests)
├── account.test.ts                      (port of InfluticsAccount.test.ts)
├── blogger.test.ts                      (port of InfluticsBlogger.test.ts)
├── trend.test.ts                        (port of InfluticsTrend.test.ts)
└── video.test.ts                        (port of InfluticsVideo.test.ts)
```

### 2.2 Node surface

```typescript
// nodes/Influtics/Influtics.node.ts
export class Influtics implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics',
    name: 'influtics',                            // was: 'influticsVideo' / 'influticsBlogger' / ...
    icon: { light: 'file:influtics-light.svg', dark: 'file:influtics-dark.svg' },
    group: ['transform'],
    version: 2,                                   // bumped from 1 to flag breaking wire format
    subtitle: '={{$parameter["resource"]}} → {{$parameter["operation"]}}',
    description: 'Track videos, manage bloggers, search trends, and read account usage',
    defaults: { name: 'Influtics' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      // Resource dropdown (always shown)
      { displayName: 'Resource', name: 'resource', type: 'options',
        options: [
          { name: 'Account', value: 'account' },
          { name: 'Blogger', value: 'blogger' },
          { name: 'Trend',   value: 'trend'   },
          { name: 'Video',   value: 'video'   },
        ], default: 'video' },

      // Per-resource operation dropdowns + params. Only the matching dropdown
      // is visible; its operation guard scopes the params that follow.
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

### 2.3 Dispatcher

```typescript
type ResourceMap = Record<
  'account' | 'blogger' | 'trend' | 'video',
  Record<string, OperationHandler>
>;

const OPERATIONS: ResourceMap = {
  account: accountModule.OPERATIONS,
  blogger: bloggerModule.OPERATIONS,
  trend:   trendModule.OPERATIONS,
  video:   videoModule.OPERATIONS,
};

export async function executeInflutics(this, _items) {
  const resource  = this.getNodeParameter('resource',   0) as keyof ResourceMap;
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler   = OPERATIONS[resource]?.[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not implemented for resource "${resource}"`,
    );
  }
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}
```

### 2.4 Resource module contract

Each `resources/{name}.ts` exports two things:

```typescript
// resources/account.ts
export const ACCOUNT_OPERATIONS: Record<string, OperationHandler> = {
  getUsage:  async function(this, i) { /* ... */ },
  getLimits: async function(this, i) { /* ... */ },
};

export function accountProperties(): INodeProperties[] {
  return [
    { displayName: 'Operation', name: 'operation', type: 'options',
      displayOptions: { show: { resource: ['account'] } },
      options: [
        { name: 'Get Limits', value: 'getLimits', action: 'Read rate limit configuration' },
        { name: 'Get Usage',  value: 'getUsage',  action: 'Read usage history and subscription summary' },
      ],
      default: 'getUsage' },
    // ...per-operation params, each guarded with
    //    displayOptions: { show: { resource: ['account'], operation: ['getUsage'] } }
  ];
}
```

The compound `displayOptions.show` (resource + operation) is the verified-nodes
pattern — when the user picks a different resource, the irrelevant params
disappear from the canvas automatically.

---

## 3. Resource → Operation mapping

Every existing operation is ported verbatim — same operation name, same default,
same parameters, same wire contract. No backend changes.

### Resource: `video` (port from `InfluticsVideo`)

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| `track` | `POST /v1/videos/track` | batch URLs (≤50) |
| `getStats` | `GET /v1/videos/stats` | filters: platform, status, blogger_username, sort, order, limit + returnAll cursor |
| `getById` | `GET /v1/videos/by-id/{id}` | internal UUID |
| `getByExternalId` | `GET /v1/videos/by-external-id/{externalId}` | platform required by UI (backend ignores) |
| `updateByExternalId` | `PATCH /v1/videos/by-external-id/{externalId}` | body: notes / campaign / status / tags |

### Resource: `blogger` (port from `InfluticsBlogger`)

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| `track` | `POST /v1/bloggers/track` | `initial_videos_count` required, integer in [1..500] |
| `getJob` | `GET /v1/bloggers/jobs/{jobId}` | poll job status |
| `byUsername` | `GET /v1/bloggers/by-username/{username}?platform=` | read-only, platform optional |

### Resource: `trend` (port from `InfluticsTrend`)

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| `search` | `GET /v1/trends/search` | keyword + platform (tiktok \| youtube); optional cursor/region/days |

### Resource: `account` (port from `InfluticsAccount`)

| Operation | Endpoint | Notes |
|-----------|----------|-------|
| `getUsage` | `GET /v1/account/usage` | no params |
| `getLimits` | `GET /v1/account/limits` | no params |

**Total: 12 operations** (5 + 3 + 1 + 2 + 1). Same wire contract as today.

### Parameter naming collisions

The four old nodes each declared their own `name: 'platform'` parameter. After
consolidation we keep all four in their respective resource submodules —
`displayOptions.show.resource` filters which one is visible, so they do not
collide. Same for `urls`, `id`, `externalId`, `keyword`, etc. — all unchanged.

---

## 4. Test strategy

Two-tier model: per-resource unit tests (the bulk, covering every existing case)
plus a thin dispatcher integration test.

### 4.1 Tier 1 — per-resource unit tests

Each resource file exports its `OPERATIONS` map directly, so the existing tests
port with a single import change.

```typescript
// __tests__/video.test.ts (was InfluticsVideo.test.ts)
import { VIDEO_OPERATIONS } from '../nodes/Influtics/resources/video';

describe('video.track', () => {
  it('posts URLs to /v1/videos/track', async () => {
    const mockCtx = makeMockContext({ /* urls: [...] */ });
    const result = await VIDEO_OPERATIONS.track.call(mockCtx, 0);
    expect(/* ... */);
  });
});
```

What stays identical:
- All `nock(...)` blocks — same wire contracts, same endpoints
- Every assertion — same expected outputs
- Every negative case — same defensive guards

What changes per file:
- Imports: `executeInfluticsVideo` → `VIDEO_OPERATIONS` (one symbol swap per describe block)
- Mock context: extended to set `resource` (default per file matches the resource under test)
- Dispatch: tests call `VIDEO_OPERATIONS.track.call(ctx, 0)` directly — bypasses the dispatcher
- File rename + path: `InfluticsVideo.test.ts` → `__tests__/video.test.ts`

### 4.2 Tier 2 — dispatcher integration tests

New file: `__tests__/dispatcher.test.ts` (~80 LOC). Smoke-tests routing only:

```typescript
describe('executeInflutics dispatcher', () => {
  it.each([
    ['video.track', 'video'],
    ['video.getStats', 'video'],
    ['video.getById', 'video'],
    ['video.getByExternalId', 'video'],
    ['video.updateByExternalId', 'video'],
    ['blogger.track', 'blogger'],
    ['blogger.getJob', 'blogger'],
    ['blogger.byUsername', 'blogger'],
    ['trend.search', 'trend'],
    ['account.getUsage', 'account'],
    ['account.getLimits', 'account'],
  ])('%s routes to its handler', async (key, resource) => {
    const [res, op] = key.split('.');
    const ctx = makeMockContext({ resource, operation: op, /* minimal required params */ });
    await executeInflutics.call(ctx, []);
    // assert nock interceptor was hit, assert single output item
  });

  it('throws NodeOperationError on unknown resource', async () => {
    const ctx = makeMockContext({ resource: 'unknown', operation: 'foo' });
    await expect(executeInflutics.call(ctx, [])).rejects.toThrow(NodeOperationError);
  });

  it('throws NodeOperationError on unknown operation', async () => {
    const ctx = makeMockContext({ resource: 'video', operation: 'bogus' });
    await expect(executeInflutics.call(ctx, [])).rejects.toThrow(NodeOperationError);
  });
});
```

### 4.3 `__tests__/GenericFunctions.test.ts` — UNCHANGED

160 lines, tests `influticsApiRequest` + `mapInfluticsError`. Already shared.

### 4.4 Shared helper

`makeMockContext()` currently lives inline in each test file. Extract to:

```typescript
// __tests__/helpers/mockContext.ts (NEW)
export function makeMockContext(params: Record<string, unknown>) {
  return {
    getNodeParameter: vi.fn((name: string, _i: number, defaultValue?: unknown) =>
      params[name] ?? defaultValue),
    getNode: vi.fn(() => ({ /* minimal INode */ })),
    helpers: { httpRequestWithAuthentication: vi.fn() /* ... */ },
  };
}
```

### 4.5 Final test footprint

| File | LOC | Status |
|------|-----|--------|
| `__tests__/GenericFunctions.test.ts` | ~160 | unchanged |
| `__tests__/dispatcher.test.ts` | ~80 | new |
| `__tests__/account.test.ts` | ~342 | ported |
| `__tests__/blogger.test.ts` | ~538 | ported |
| `__tests__/trend.test.ts` | ~560 | ported |
| `__tests__/video.test.ts` | ~796 | ported |
| **Total** | **~2,476** | (vs 2,236 today; ~10% growth from dispatcher tests) |

---

## 5. `package.json` + `index.ts` + build

### 5.1 `package.json`

```diff
-  "version": "1.0.10",
+  "version": "1.1.0",
```

```diff
   "n8n": {
     "n8nNodesApiVersion": 1,
     "nodes": [
-      "dist/nodes/InfluticsAccount/InfluticsAccount.node.js",
-      "dist/nodes/InfluticsBlogger/InfluticsBlogger.node.js",
-      "dist/nodes/InfluticsTrend/InfluticsTrend.node.js",
-      "dist/nodes/InfluticsVideo/InfluticsVideo.node.js"
+      "dist/nodes/Influtics/Influtics.node.js"
     ],
     "credentials": [
       "dist/credentials/InfluticsApi.credentials.js"
     ]
   }
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

`scripts.*` and `peerDependencies` are unchanged.

### 5.2 `index.ts`

```diff
 export { InfluticsApi } from './credentials/InfluticsApi.credentials';
-export { InfluticsVideo } from './nodes/InfluticsVideo/InfluticsVideo.node';
-export { InfluticsBlogger } from './nodes/InfluticsBlogger/InfluticsBlogger.node';
-export { InfluticsTrend } from './nodes/InfluticsTrend/InfluticsTrend.node';
-export { InfluticsAccount } from './nodes/InfluticsAccount/InfluticsAccount.node';
+export { Influtics } from './nodes/Influtics/Influtics.node';
```

### 5.3 File deletions

Performed **only after** the new node + ported tests pass `lint + test + build + scan-community-package`:

```
rm -rf nodes/InfluticsAccount
rm -rf nodes/InfluticsBlogger
rm -rf nodes/InfluticsTrend
rm -rf nodes/InfluticsVideo
rm -f  __tests__/InfluticsAccount.test.ts
rm -f  __tests__/InfluticsBlogger.test.ts
rm -f  __tests__/InfluticsTrend.test.ts
rm -f  __tests__/InfluticsVideo.test.ts
```

### 5.4 Icon handling

Each old node currently has 3 SVG files (`influtics.svg`, `influtics-light.svg`, `influtics-dark.svg`) — 12 in total. After consolidation only 3 remain:

```
nodes/Influtics/influtics.svg
nodes/Influtics/influtics-light.svg
nodes/Influtics/influtics-dark.svg
```

`credentials/Influtics.{svg,dark.svg}` are unchanged.

### 5.5 Build output

```
dist/
├── credentials/
│   └── InfluticsApi.credentials.js
├── index.js
└── nodes/
    └── Influtics/
        ├── Influtics.node.js
        └── resources/
            ├── account.js
            ├── blogger.js
            ├── trend.js
            └── video.js
```

### 5.6 `eslint-plugin-n8n-nodes-base` compliance

- `node-dirname-against-convention`: `nodes/Influtics/Influtics.node.ts` exports class `Influtics` — passes.
- `resources/` files are plain `.ts` (not `.node.ts`) and export objects/functions, not INodeType — not inspected by the rule.
- Two existing `eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node` comments move into `nodes/Influtics/Influtics.node.ts` (the sole INodeType definition).

---

## 6. User-facing migration

### 6.1 `CHANGELOG.md`

```markdown
## [1.1.0] - 2026-08-XX

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

### 6.2 `README.md` — three edits

1. **`## Operations` preamble callout** (between intro and first table):

   > **Heads-up if you're upgrading from ≤ 1.0.10:** the four legacy nodes
   > (`Influtics Video`, `Influtics Blogger`, `Influtics Trend`, `Influtics Account`)
   > have been merged into a single **`Influtics`** node. Each surface is now a
   > **Resource** dropdown. Workflows referencing the old node types must be
   > re-created — see [CHANGELOG → 1.1.0](./CHANGELOG.md) for steps.

2. **Four operations tables under `## Operations`** — `Account`, `Blogger`,
   `Trend`, `Video`. Columns: `Operation | Description`. No Cost column.

3. **`### Upgrading from ≤ 1.0.10`** under `## Troubleshooting`:

   > **Symptom:** After installing v1.1.0, an existing workflow errors with
   > `Node type influticsVideo is not known`. (The exact type name appears in the
   > error toast on the failing node.)
   >
   > **Cause:** v1.1.0 merges the four legacy nodes into a single `Influtics` action
   > node. n8n does not auto-rename community-node types.
   >
   > **Fix:** Delete the old node from the canvas and drop a new `Influtics` node.
   > Pick the matching **Resource** (Video / Blogger / Trend / Account) and the same
   > **Operation** you had before. All parameter names and types are unchanged.

### 6.3 What we are NOT doing

- ❌ **No auto-migration script.** Quietly rewriting workflow JSON would corrupt
  credentials, parameters, and webhook URLs. n8n's own verified-node v1 → v2
  precedent is "re-create by hand"; we follow it.
- ❌ **No deprecation stub wrappers.** A wrapper that throws "use the new node" on
  execute silently breaks every existing run.
- ❌ **No `n8n.communityNodes.deprecation` field.** Community-node loader does not
  honour it.

---

## 7. Release & re-review flow

### 7.1 Pre-publish gate (local)

```bash
npm run lint              # eslint clean
npm test                  # vitest green (dispatcher + 4 resource test files)
npm run build             # n8n-node build → dist/nodes/Influtics/Influtics.node.js
npm run scan:package      # n8n official scanner, 0 errors
```

### 7.2 Publish (CI only)

```bash
git checkout main
git pull
git tag -a v1.1.0 -m "v1.1.0"
git push origin v1.1.0
# → GitHub Actions release.yml → npm publish --provenance --access public
```

### 7.3 Post-publish verification

```bash
npm view n8n-nodes-influtics@1.1.0 dist.provenance
npm view n8n-nodes-influtics versions --json | tail -5
```

### 7.4 n8n re-review notification

Reply to the original verification-team email (or creators-portal ticket — see
memory `feedback_n8n-creator-portal-submission-url.md`):

```
Subject: Re: n8n-nodes-influtics — [HIGH] Multiple regular nodes in a single package

Hi n8n team,

Thanks for the feedback. We've restructured the package to a single action
node per the verified-nodes guidelines.

What's in v1.1.0:
- One node: `Influtics`
- Four resources: Account / Blogger / Trend / Video
- 12 operations under their respective resources
- All existing wire contracts preserved (zero backend changes)
- npm package: https://www.npmjs.com/package/n8n-nodes-influtics/v/1.1.0
- dist.provenance: <paste URL>
- @n8n/scan-community-package: clean

CHANGELOG entry: https://github.com/Influtics/n8n-nodes-influtics/blob/main/CHANGELOG.md#110

Happy to address any further findings.

— Influtics
```

---

## 8. Out of scope for v1.1.0

- ❌ Adding a trigger node (`Influtics Trigger` for new-trend / new-video webhooks).
- ❌ Adding `n8n-nodes-base` parity features.
- ❌ Renaming or re-grouping operations.
- ❌ Touching the `InfluticsApi` credential.

---

## 9. Risk register

| Risk | Mitigation |
|------|------------|
| Existing workflow breaks silently on n8n auto-update | CHANGELOG `⚠️ BREAKING` header + README callout are explicit. n8n community-node auto-update is opt-in for cloud users; self-hosted users see the version in the install UI. |
| `eslint-plugin-n8n-nodes-base` flags the new `resources/` subfolder | The plugin only inspects `*.node.ts` files. Pre-flight `npm run lint` catches surprises. |
| `@n8n/scan-community-package` flags `version: 2` (node version bump) | Scanner checks for malicious patterns + structural conventions; `version` is informational, not flagged. |
| A test file's `makeMockContext` helper has a typo during porting | Run `npm test` after each resource port, not at the end. Tier-2 dispatcher tests catch any resource that didn't get ported. |
| npm publish races with a hot fix | Tag-push is the publish trigger. Replay: `git tag -d v1.1.0 && git push origin :refs/tags/v1.1.0 && git tag -a v1.1.0 -m "v1.1.0" && git push origin v1.1.0`. |

---

## 10. Decision log

- **v1.1.0 (not v2.0.0):** user-chosen minor bump despite breaking change; documents
  the move explicitly in CHANGELOG.
- **Glue file + `resources/` subfolders:** preferred over monolithic file or
  top-level `resources/{name}.ts` for clearer separation + future extensibility.
- **4 README tables (not 1 mega-table):** selected for skim-ability and 1:1 match
  with the n8n canvas resource dropdown.
- **No Cost column:** dropped per user instruction (cost info remains in
  `influticsApiRequest` rate-limit handlers but is not surfaced in README).
- **Test files renamed to `__tests__/{resource}.test.ts`:** drops the
  `Influtics*` prefix to match the source-side resource folder naming.
- **`name: 'influtics'`:** matches Airtable/HubSpot/Notion convention; existing
  workflows with `influticsVideo` etc. break explicitly per CHANGELOG.
