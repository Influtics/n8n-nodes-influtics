# Influtics n8n Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `n8n-nodes-influtics` v1.0.0 to npm as a public community node that wraps every endpoint of the Influtics public REST API.

**Architecture:** TypeScript package built on n8n's community-node model (`n8n-node` CLI). Four resource-grouped nodes (Video, Blogger, Trend, Account) share a single `InfluticsApi` credential and a single HTTP transport. Async `POST /v1/bloggers/track` is exposed as a `Track` operation that returns `job_id`, paired with a `Get Job` operation (no internal polling).

**Tech Stack:** TypeScript, Node 20+, `n8n-nodes-base` (peer dep), `n8n-node` CLI for build/lint, Vitest + nock for tests, GitHub Actions for CI.

**Repo root for all commands below:** `/Users/ivanabramov/Desktop/n8n x Influtics/`

**Spec:** `plans/2026-08-23-n8n-nodes-influtics-design.md` (canonical source of truth for endpoint shapes, auth, error mapping, and distribution).

**Worktree note:** This is a greenfield repo created in this session; there is no existing branch to worktree from. Implementation happens directly on `main` until the first release tag, then a `develop` branch (or per-feature branches) is the right next step. PRs from forks/feature branches are the long-term model.

---

## File Structure

```
n8n-nodes-influtics/
├── package.json                                # name=n8n-nodes-influtics, keywords=[n8ncommunity]
├── tsconfig.json                               # strict, ES2022 target, node module resolution
├── .eslintrc.js                                # extends n8n-nodes-base
├── .prettierrc.js                              # n8n defaults
├── .github/workflows/ci.yml                    # lint + test on push/PR
├── README.md                                   # exists (added by bootstrap commit)
├── LICENSE                                     # exists (MIT)
├── .gitignore                                  # exists (Node)
├── CHANGELOG.md                                # Keep a Changelog format
├── plans/
│   ├── 2026-08-23-n8n-nodes-influtics-design.md # exists
│   └── 2026-08-24-n8n-nodes-influtics-plan.md   # this file
├── credentials/
│   └── InfluticsApi.credentials.ts             # 1 credential type: API key
├── nodes/
│   ├── GenericFunctions.ts                     # shared HTTP transport + error mapper
│   ├── InfluticsVideo.node.ts                  # 5 operations
│   ├── InfluticsBlogger.node.ts                # 3 operations
│   ├── InfluticsTrend.node.ts                  # 1 operation
│   └── InfluticsAccount.node.ts                # 2 operations
└── __tests__/
    ├── GenericFunctions.test.ts                # error mapper unit tests
    ├── InfluticsVideo.test.ts                  # 5 ops × {success, error, paywall}
    ├── InfluticsBlogger.test.ts                # 3 ops × {success, error}
    ├── InfluticsTrend.test.ts                  # 1 op × {success, error}
    └── InfluticsAccount.test.ts                # 2 ops × {success, error}
```

---

## Task 1: Package scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.eslintrc.js`
- Create: `.prettierrc.js`
- Create: `.github/workflows/ci.yml`
- Create: `CHANGELOG.md`

- [ ] **Step 1: Write `package.json`** with the following content. The `name`, `description`, `keywords`, and `n8n` block (with `nodes` and `credentials` globs) are required for the package to install as an n8n community node.

```json
{
  "name": "n8n-nodes-influtics",
  "version": "0.1.0",
  "description": "Official Influtics integration for n8n — track influencer videos, bloggers, and trends",
  "keywords": ["n8n", "n8n-community-node", "n8ncommunity", "influtics", "influencer-marketing"],
  "license": "MIT",
  "type": "module",
  "main": "dist/index.js",
  "files": ["dist"],
  "scripts": {
    "build": "n8n-node build",
    "dev": "n8n-node dev",
    "lint": "eslint . --ext .ts",
    "lintfix": "eslint . --ext .ts --fix",
    "format": "prettier --write .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "engines": {
    "node": ">=20.0.0"
  },
  "peerDependencies": {
    "n8n-nodes-base": "*",
    "n8n-workflow": "*"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "@typescript-eslint/parser": "^7.0.0",
    "eslint": "^8.57.0",
    "eslint-plugin-n8n-nodes-base": "^1.16.0",
    "nock": "^14.0.0",
    "prettier": "^3.3.0",
    "ts-node": "^10.9.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "vitest-mock-extended": "^2.0.0"
  },
  "n8n": {
    "nodes": ["dist/nodes/**/*.node.js"],
    "credentials": ["dist/credentials/**/*.credentials.js"]
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": false,
    "sourceMap": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"]
  },
  "include": ["nodes/**/*", "credentials/**/*", "__tests__/**/*", "vitest.config.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Write `.eslintrc.js`** extending n8n-nodes-base:

```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  extends: ['eslint-plugin-n8n-nodes-base'],
  ignorePatterns: ['dist/**', 'node_modules/**'],
};
```

- [ ] **Step 4: Write `.prettierrc.js`** with n8n defaults:

```js
module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
};
```

- [ ] **Step 5: Write `.github/workflows/ci.yml`** to lint + test on every push/PR:

```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

- [ ] **Step 6: Write `CHANGELOG.md`** Keep a Changelog format with v0.1.0 in progress:

```markdown
# Changelog

All notable changes to `n8n-nodes-influtics` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/), versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Initial community-node release covering all public Influtics API endpoints.

## [0.1.0] - TBD

### Added
- InfluticsApi credential (single API key).
- InfluticsVideo node: Track, Get Stats, Get By ID, Get By External ID, Update By External ID.
- InfluticsBlogger node: Track, Get Job, By Username.
- InfluticsTrend node: Search.
- InfluticsAccount node: Get Usage, Get Limits.
- Shared GenericFunctions transport + error mapper.
- Vitest test suite with nock fixtures covering success, error, and 402 paywall cases.
- GitHub Actions CI (lint + test).
```

- [ ] **Step 7: Install dependencies**

Run from repo root:
```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && npm install
```
Expected: completes without errors; `node_modules/` and `package-lock.json` are written.

- [ ] **Step 8: Write `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 9: Verify scaffold lints clean (no source files yet, so should pass)**

Run: `npm run lint`
Expected: exits 0 with no errors. (Linter may complain about no source files — that's fine for now; the real verification happens in Task 2 when there's actual code.)

- [ ] **Step 10: Commit scaffold**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add package.json package-lock.json tsconfig.json .eslintrc.js .prettierrc.js vitest.config.ts .github/ CHANGELOG.md && git commit -m "chore: scaffold n8n-nodes-influtics package

Initial TypeScript scaffold for the Influtics community-node package:
package.json with n8n community-nodes manifest, tsconfig, eslint/prettier
configs, vitest config, CI workflow, and CHANGELOG.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: GenericFunctions transport + error mapper

**Files:**
- Create: `nodes/GenericFunctions.ts`
- Test: `__tests__/GenericFunctions.test.ts`

This is the shared helper every node imports for HTTP calls and error normalization. TDD: write the test first.

- [ ] **Step 1: Write the failing test in `__tests__/GenericFunctions.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import {
  influticsApiRequest,
  influticsApiRequestAllItems,
  mapInfluticsError,
} from '../nodes/GenericFunctions';

const BASE_URL = 'https://api.influtics.com';

describe('GenericFunctions', () => {
  // Block real network so accidental unmocked calls fail loudly.
  beforeAll(() => {
    nock.disableNetConnect();
  });

  // Re-enable for any local debugging (e.g. localstack runs on 127.0.0.1).
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('mapInfluticsError', () => {
    it('maps an API error response into an Error carrying code + message + upgrade URL', () => {
      const error = {
        response: {
          statusCode: 402,
          body: {
            success: false,
            error: {
              code: 'PAID_PLAN_REQUIRED',
              message: 'Upgrade required',
              upgrade_url: 'https://influtics.com/plans',
            },
          },
        },
      };
      const mapped = mapInfluticsError(error);
      expect(mapped.message).toContain('PAID_PLAN_REQUIRED');
      expect(mapped.message).toContain('Upgrade required');
      expect((mapped as any).description).toContain('influtics.com/plans');
    });

    it('passes through non-API errors unchanged', () => {
      const error = new Error('connection refused');
      const mapped = mapInfluticsError(error);
      expect(mapped.message).toContain('connection refused');
    });
  });

  describe('influticsApiRequest', () => {
    let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;
    beforeEach(() => {
      ctx = mockDeep<IExecuteFunctions>();
      ctx.getNode = vi.fn().mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
      ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
      ctx.helpers = {
        // Mirror n8n's real `requestWithAuthentication` with `json: true`:
        //   - 2xx → returns the parsed JSON body directly
        //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
        // The implementation reads `rawError.response.body.error` via mapInfluticsError.
        requestWithAuthentication: vi.fn(async (_name, opts) => {
          const res = await fetch((opts as any).uri ?? (opts as any).url, {
            method: (opts as any).method ?? 'GET',
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
        }) as any,
      } as any;
    });

    it('returns parsed JSON body on 2xx', async () => {
      nock(BASE_URL).post('/v1/videos/track').reply(200, { success: true, data: { tracked: 3 } });
      const out = await influticsApiRequest.call(ctx as any, 'POST', '/v1/videos/track', {
        urls: ['https://tiktok.com/x'],
      });
      expect(out).toEqual({ success: true, data: { tracked: 3 } });
    });

    it('throws a mapped error on 4xx', async () => {
      nock(BASE_URL).get('/v1/videos/stats').reply(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      });
      await expect(influticsApiRequest.call(ctx as any, 'GET', '/v1/videos/stats')).rejects.toThrow(
        /UNAUTHORIZED/,
      );
    });
  });

  describe('influticsApiRequestAllItems', () => {
    let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;
    beforeEach(() => {
      ctx = mockDeep<IExecuteFunctions>();
      ctx.getNode = vi.fn().mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
      ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
      ctx.helpers = {
        requestWithAuthentication: vi.fn(async (_name, opts) => {
          const res = await fetch((opts as any).url, {
            method: (opts as any).method,
            headers: (opts as any).headers,
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
    });

    it('aggregates paginated data across two pages until meta.next_cursor is absent', async () => {
      nock(BASE_URL)
        .get('/v1/videos/stats')
        .query(true)
        .reply(200, {
          success: true,
          data: [{ id: 'v1' }, { id: 'v2' }],
          meta: { next_cursor: 'cur-2' },
        })
        .get('/v1/videos/stats')
        .query({ cursor: 'cur-2' })
        .reply(200, {
          success: true,
          data: [{ id: 'v3' }],
          meta: {},
        });

      const out = await influticsApiRequestAllItems.call(ctx as any, 'GET', '/v1/videos/stats');
      expect(out).toEqual([{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]);
    });

    it('returns a single page when no cursor is returned', async () => {
      nock(BASE_URL).get('/v1/videos/stats').reply(200, {
        success: true,
        data: [{ id: 'v1' }],
        meta: {},
      });

      const out = await influticsApiRequestAllItems.call(ctx as any, 'GET', '/v1/videos/stats');
      expect(out).toEqual([{ id: 'v1' }]);
    });
  });
});
```

- [ ] **Step 2: Add `vitest-mock-extended` to devDependencies and install**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && npm install --save-dev vitest-mock-extended
```

- [ ] **Step 3: Run the test — confirm it fails (no implementation yet)**

Run: `npx vitest run __tests__/GenericFunctions.test.ts`
Expected: FAIL — `Cannot find module '../nodes/GenericFunctions'`.

- [ ] **Step 4: Implement `nodes/GenericFunctions.ts`**

```typescript
import type { IExecuteFunctions, IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const INFLUTICS_API_BASE_URL = 'https://api.influtics.com';
export const CREDENTIAL_NAME = 'influticsApi';

interface ApiErrorBody {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    upgrade_url?: string;
    request_id?: string;
    [k: string]: unknown;
  };
}

function extractApiErrorBody(error: any): { code?: string; message?: string; upgrade_url?: string } {
  const body: ApiErrorBody | undefined = error?.response?.body;
  const inner = body?.error;
  return {
    code: inner?.code,
    message: inner?.message,
    upgrade_url: (inner as any)?.upgrade_url,
  };
}

export function mapInfluticsError(error: any): Error {
  const { code, message, upgrade_url } = extractApiErrorBody(error);
  if (code || message) {
    const descParts: string[] = [];
    if (upgrade_url) descParts.push(`Upgrade: ${upgrade_url}`);
    const finalMessage = `${code ?? 'API_ERROR'}: ${message ?? 'Unknown error'}`;
    const e = new Error(finalMessage);
    (e as any).description = descParts.join('\n') || undefined;
    return e;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function influticsApiRequest(
  this: IExecuteFunctions,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<any> {
  const options: IHttpRequestOptions = {
    method,
    url: `${INFLUTICS_API_BASE_URL}${endpoint}`,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // Authorization header is injected by the credential's `authenticate` block.
    },
    json: true,
    ...(body ? { body } : {}),
    ...(qs ? { qs } : {}),
  };

  try {
    const response = await this.helpers.requestWithAuthentication.call(
      this,
      CREDENTIAL_NAME,
      options,
    );
    return response;
  } catch (rawError: any) {
    // Map the raw helper error into { code, message, description }. The description
    // carries the upgrade URL on 402 PAID_PLAN_REQUIRED so it surfaces in the n8n UI
    // without code-fishing. Both message AND description MUST go through NodeApiError's
    // options bag, since the wrapped `rawError` itself has no description on it.
    const mapped = mapInfluticsError(rawError);
    throw new NodeApiError(this.getNode(), rawError, {
      message: mapped.message,
      description: (mapped as any).description,
    });
  }
}

/**
 * Cursor-aware paginator for endpoints that expose `next_cursor`. Influtics
 * returns the cursor under `meta.next_cursor`; we fold every page's `data`
 * into a single array so downstream n8n nodes see one item per record.
 *
 * Endpoints that don't paginate today just return a single page (no cursor);
 * in that case the caller still gets back one combined array.
 */
export async function influticsApiRequestAllItems(
  this: IExecuteFunctions,
  method: 'GET',
  endpoint: string,
  qs?: IDataObject,
): Promise<any[]> {
  const aggregated: any[] = [];
  let cursor: string | undefined;

  // Hard cap on pages so a runaway cursor can't DOS the workflow.
  for (let page = 0; page < 50; page++) {
    const pageQs: IDataObject = { ...(qs ?? {}) };
    if (cursor) pageQs.cursor = cursor;

    const response = await influticsApiRequest.call(this, method, endpoint, undefined, pageQs);
    const items: any[] = Array.isArray(response?.data) ? response.data : [];
    aggregated.push(...items);

    const next = response?.meta?.next_cursor;
    if (!next) break;
    cursor = next;
  }

  return aggregated;
}
```

- [ ] **Step 5: Run tests — confirm they pass**

Run: `npx vitest run __tests__/GenericFunctions.test.ts`
Expected: PASS — 6 tests passing (mapInfluticsError × 2, influticsApiRequest × 2, influticsApiRequestAllItems × 2).

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/GenericFunctions.ts __tests__/GenericFunctions.test.ts package.json package-lock.json && git commit -m "feat(transport): add GenericFunctions with API request helper + error mapper

Wraps n8n's requestWithAuthentication with the Influtics base URL and
Bearer auth. Maps API error responses (PAID_PLAN_REQUIRED, etc.) into
NodeOperationError instances carrying the upgrade_url in description.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: InfluticsApi credential

**Files:**
- Create: `credentials/InfluticsApi.credentials.ts`

No separate test file — credential shape is exercised by every node test that hits the API.

- [ ] **Step 1: Write `credentials/InfluticsApi.credentials.ts`**

```typescript
import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class InfluticsApi implements ICredentialType {
  name = 'influticsApi';
  displayName = 'Influtics API';
  documentationUrl = 'https://influtics.com/api-reference/authentication';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Get your API key from the Influtics dashboard under Settings → API.',
    },
  ];
  // Inject the Authorization header on every request so individual nodes
  // never need to manage it. See GenericFunctions.influticsApiRequest.
  authenticate = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{ $credentials.apiKey }}',
      },
    },
  } as const;
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add credentials/InfluticsApi.credentials.ts && git commit -m "feat(credentials): add InfluticsApi credential (single Bearer API key)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: InfluticsVideo node — Track operation (TDD)

**Files:**
- Test: `__tests__/InfluticsVideo.test.ts` (start with Track only)
- Create: `nodes/InfluticsVideo.node.ts` (start with Track only; other ops in Tasks 5–7)

This task builds the Video node incrementally — one operation per task so each is testable on its own. **Track** first.

- [ ] **Step 1: Write the failing test for Track**

In `__tests__/InfluticsVideo.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeInfluticsVideo } from '../nodes/InfluticsVideo.node';

const BASE_URL = 'https://api.influtics.com';

describe('InfluticsVideo node — Track operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'track',
        urls: { urls: ['https://tiktok.com/@a/video/1', 'https://tiktok.com/@b/video/2'] },
      };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, {
          method: (opts as any).method,
          headers: (opts as any).headers,
          body: (opts as any).body ? JSON.stringify((opts as any).body) : undefined,
        });
        return { statusCode: res.status, headers: {}, body: await res.text() };
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('POSTs urls array to /v1/videos/track and returns parsed response', async () => {
    nock(BASE_URL)
      .post('/v1/videos/track', { urls: ['https://tiktok.com/@a/video/1', 'https://tiktok.com/@b/video/2'] })
      .reply(200, { success: true, data: { tracked: 2, skipped: 0 } });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0]).toEqual([{ json: { success: true, data: { tracked: 2, skipped: 0 } } }]);
  });

  it('surfaces a 402 PAID_PLAN_REQUIRED error to the caller', async () => {
    nock(BASE_URL)
      .post('/v1/videos/track')
      .reply(402, {
        success: false,
        error: {
          code: 'PAID_PLAN_REQUIRED',
          message: 'Upgrade required',
          upgrade_url: 'https://influtics.com/plans',
        },
      });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /PAID_PLAN_REQUIRED/,
    );
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Video node with ONLY the Track operation wired up**

Create `nodes/InfluticsVideo.node.ts`:

```typescript
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from './GenericFunctions';

export async function executeInfluticsVideo(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    if (operation === 'track') {
      const urlsParam = this.getNodeParameter('urls', i) as { urls: string[] };
      const response = await influticsApiRequest.call(
        this,
        'POST',
        '/v1/videos/track',
        { urls: urlsParam.urls },
      );
      returnData.push({ json: response });
    } else {
      throw new Error(`Operation "${operation}" not yet implemented in InfluticsVideo node`);
    }
  }
  return [returnData];
}

export class InfluticsVideo implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Video',
    name: 'influticsVideo',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Track and read Influtics videos',
    defaults: { name: 'Influtics Video' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [{ name: 'Track', value: 'track', description: 'Track videos by URL' }],
        default: 'track',
      },
      {
        displayName: 'URLs',
        name: 'urls',
        type: 'collection',
        displayOptions: { show: { operation: ['track'] } },
        default: {},
        options: [
          {
            displayName: 'URLs',
            name: 'urls',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Up to 50 video URLs to track',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsVideo.call(this, this.getInputData());
  }
}
```

- [ ] **Step 4: Run test — confirm Track passes**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsVideo.node.ts __tests__/InfluticsVideo.test.ts && git commit -m "feat(video): implement Track operation for InfluticsVideo node

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: InfluticsVideo node — Get Stats operation

**Files:**
- Modify: `__tests__/InfluticsVideo.test.ts`
- Modify: `nodes/InfluticsVideo.node.ts`

- [ ] **Step 1: Append failing tests for Get Stats to `__tests__/InfluticsVideo.test.ts`**

Add a new describe block:

```typescript
describe('InfluticsVideo node — Get Stats operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: ['tiktok'],
        campaign: ['aug'],
        blogger: ['@alice'],
        search: 'fyp',
        publishedFrom: '2026-08-01',
        publishedTo: '2026-08-23',
      };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, { method: (opts as any).method, headers: (opts as any).headers });
        return { statusCode: res.status, headers: {}, body: await res.text() };
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('GETs /v1/videos/stats with filters as query string', async () => {
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query({
        platform: 'tiktok',
        campaign: 'aug',
        blogger: '@alice',
        search: 'fyp',
        published_from: '2026-08-01',
        published_to: '2026-08-23',
      })
      .reply(200, { success: true, data: [{ id: 'v1', views: 12345 }] });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].views).toBe(12345);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: FAIL — operation not implemented.

- [ ] **Step 3: Extend `executeInfluticsVideo` to handle `getStats`**

Replace the `if (operation === 'track')` chain with:

```typescript
export async function executeInfluticsVideo(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    if (operation === 'track') {
      const urlsParam = this.getNodeParameter('urls', i) as { urls: string[] };
      const response = await influticsApiRequest.call(this, 'POST', '/v1/videos/track', {
        urls: urlsParam.urls,
      });
      returnData.push({ json: response });
    } else if (operation === 'getStats') {
      const qs: IDataObject = {};
      const platform = this.getNodeParameter('platform', i, []) as string[];
      const campaign = this.getNodeParameter('campaign', i, []) as string[];
      const blogger = this.getNodeParameter('blogger', i, []) as string[];
      const search = this.getNodeParameter('search', i, '') as string;
      const publishedFrom = this.getNodeParameter('publishedFrom', i, '') as string;
      const publishedTo = this.getNodeParameter('publishedTo', i, '') as string;
      const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
      if (platform?.length) qs.platform = platform;
      if (campaign?.length) qs.campaign = campaign;
      if (blogger?.length) qs.blogger = blogger;
      if (search) qs.search = search;
      if (publishedFrom) qs.published_from = publishedFrom;
      if (publishedTo) qs.published_to = publishedTo;

      // Use the paginator when the caller asks for "all"; single-call otherwise.
      const response = returnAll
        ? { data: await influticsApiRequestAllItems.call(this, 'GET', '/v1/videos/stats', qs) }
        : await influticsApiRequest.call(this, 'GET', '/v1/videos/stats', undefined, qs);
      returnData.push({ json: response });
    } else {
      throw new Error(`Operation "${operation}" not yet implemented in InfluticsVideo node`);
    }
  }
  return [returnData];
}
```

Then update the import line at the top of the file:

```typescript
import { influticsApiRequest, influticsApiRequestAllItems } from './GenericFunctions';
```

Replace the `properties` array on the node description with the full block below (adds `getStats` + every `INodeProperties` entry with `displayOptions`):

```typescript
properties: [
  {
    displayName: 'Operation',
    name: 'operation',
    type: 'options',
    noDataExpression: true,
    options: [
      { name: 'Track', value: 'track', description: 'Track videos by URL' },
      { name: 'Get Stats', value: 'getStats', description: 'Read video-level metrics' },
      { name: 'Get By ID', value: 'getById', description: 'Read one tracked video by internal ID' },
      { name: 'Get By External ID', value: 'getByExternalId', description: 'Read one tracked video by platform + external ID' },
      { name: 'Update By External ID', value: 'updateByExternalId', description: 'Patch metadata on a tracked video' },
    ],
    default: 'track',
  },
  // --- Track --------------------------------------------------------------
  {
    displayName: 'URLs',
    name: 'urls',
    type: 'collection',
    displayOptions: { show: { operation: ['track'] } },
    default: {},
    options: [
      {
        displayName: 'URLs',
        name: 'urls',
        type: 'string',
        typeOptions: { multipleValues: true },
        default: [],
        description: 'Up to 50 video URLs to track',
      },
    ],
  },
  // --- Get Stats ----------------------------------------------------------
  {
    displayName: 'Return All',
    name: 'returnAll',
    type: 'boolean',
    displayOptions: { show: { operation: ['getStats'] } },
    default: false,
    description: 'Whether to fetch every page via cursor pagination',
  },
  {
    displayName: 'Limit',
    name: 'limit',
    type: 'number',
    displayOptions: { show: { operation: ['getStats'], returnAll: [false] } },
    typeOptions: { minValue: 1, maxValue: 100 },
    default: 50,
    description: 'Max results (single-page mode only)',
  },
  {
    displayName: 'Platform',
    name: 'platform',
    type: 'multiOptions',
    displayOptions: { show: { operation: ['getStats'] } },
    options: [
      { name: 'TikTok', value: 'tiktok' },
      { name: 'Instagram', value: 'instagram' },
      { name: 'YouTube', value: 'youtube' },
      { name: 'VK', value: 'vk' },
    ],
    default: [],
    description: 'Restrict to one or more platforms',
  },
  {
    displayName: 'Campaign',
    name: 'campaign',
    type: 'string',
    displayOptions: { show: { operation: ['getStats'] } },
    default: '',
    description: 'Filter by campaign tag',
  },
  {
    displayName: 'Blogger Username',
    name: 'blogger',
    type: 'string',
    displayOptions: { show: { operation: ['getStats'] } },
    default: '',
    description: 'Filter by blogger username',
  },
  {
    displayName: 'Search',
    name: 'search',
    type: 'string',
    displayOptions: { show: { operation: ['getStats'] } },
    default: '',
    description: 'Free-text search across tracked videos',
  },
  {
    displayName: 'Published From',
    name: 'publishedFrom',
    type: 'dateTime',
    displayOptions: { show: { operation: ['getStats'] } },
    default: '',
  },
  {
    displayName: 'Published To',
    name: 'publishedTo',
    type: 'dateTime',
    displayOptions: { show: { operation: ['getStats'] } },
    default: '',
  },
  // --- Get By ID ----------------------------------------------------------
  {
    displayName: 'Video ID',
    name: 'id',
    type: 'string',
    displayOptions: { show: { operation: ['getById'] } },
    default: '',
    required: true,
  },
  // --- Get By External ID / Update By External ID ------------------------
  {
    displayName: 'External ID',
    name: 'externalId',
    type: 'string',
    displayOptions: { show: { operation: ['getByExternalId', 'updateByExternalId'] } },
    default: '',
    required: true,
    description: 'The platform-specific video ID (e.g. TikTok video id)',
  },
  {
    displayName: 'Platform',
    name: 'platform',
    type: 'options',
    displayOptions: { show: { operation: ['getByExternalId', 'updateByExternalId'] } },
    options: [
      { name: 'TikTok', value: 'tiktok' },
      { name: 'Instagram', value: 'instagram' },
      { name: 'YouTube', value: 'youtube' },
      { name: 'VK', value: 'vk' },
    ],
    default: 'tiktok',
    required: true,
  },
  // --- Update By External ID body fields ---------------------------------
  {
    displayName: 'Update Fields',
    name: 'updateFields',
    type: 'collection',
    displayOptions: { show: { operation: ['updateByExternalId'] } },
    default: {},
    options: [
      { displayName: 'Notes', name: 'notes', type: 'string', default: '' },
      { displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        options: [
          { name: 'To Do', value: 'to do' },
          { name: 'Running', value: 'running' },
          { name: 'Ended', value: 'ended' },
        ],
        default: 'to do',
      },
      {
        displayName: 'Tags',
        name: 'tags',
        type: 'string',
        typeOptions: { multipleValues: true },
        default: [],
        description: 'Tag names to attach (existing tags are preserved)',
      },
    ],
  },
],
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsVideo.node.ts __tests__/InfluticsVideo.test.ts && git commit -m "feat(video): implement Get Stats operation with filter query string

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: InfluticsVideo node — Get By ID, Get By External ID, Update By External ID

**Files:**
- Modify: `__tests__/InfluticsVideo.test.ts`
- Modify: `nodes/InfluticsVideo.node.ts`

Three operations, all simple single-resource lookups/updates. Combine in one task because each follows the same pattern as Task 5.

- [ ] **Step 1: Append failing tests for the remaining three operations**

```typescript
describe('InfluticsVideo node — Get By ID', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = { operation: 'getById', id: 'abc-123' };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, { method: (opts as any).method, headers: (opts as any).headers });
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('GETs /v1/videos/by-id/{id}', async () => {
    nock(BASE_URL).get('/v1/videos/by-id/abc-123').reply(200, { success: true, data: { id: 'abc-123' } });
    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.id).toBe('abc-123');
  });
});

describe('InfluticsVideo node — Get By External ID', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
      };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, { method: (opts as any).method, headers: (opts as any).headers });
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('GETs /v1/videos/by-external-id/{id}?platform=tiktok', async () => {
    nock(BASE_URL)
      .get('/v1/videos/by-external-id/ext-1')
      .query({ platform: 'tiktok' })
      .reply(200, { success: true, data: { external_id: 'ext-1' } });
    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.external_id).toBe('ext-1');
  });
});

describe('InfluticsVideo node — Update By External ID', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
        updateFields: {
          notes: 'follow up',
          campaign: 'aug',
          status: 'running',
          tags: ['urgent'],
        },
      };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, {
          method: (opts as any).method,
          headers: (opts as any).headers,
          body: (opts as any).body ? JSON.stringify((opts as any).body) : undefined,
        });
        const text = await res.text();
        return text ? JSON.parse(text) : null;
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('PATCHes /v1/videos/by-external-id/{id} with body fields from updateFields collection', async () => {
    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1', {
        notes: 'follow up',
        campaign: 'aug',
        status: 'running',
        tags: ['urgent'],
      })
      .query({ platform: 'tiktok' })
      .reply(200, { success: true, data: { updated: true } });
    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.updated).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: FAIL on the three new tests.

- [ ] **Step 3: Extend `executeInfluticsVideo` with three more branches**

Add these to the `if/else if` chain inside `executeInfluticsVideo`:

```typescript
else if (operation === 'getById') {
  const id = this.getNodeParameter('id', i) as string;
  const response = await influticsApiRequest.call(this, 'GET', `/v1/videos/by-id/${encodeURIComponent(id)}`);
  returnData.push({ json: response });
}
else if (operation === 'getByExternalId') {
  const externalId = this.getNodeParameter('externalId', i) as string;
  const platform = this.getNodeParameter('platform', i) as string;
  const qs = platform ? { platform } : undefined;
  const response = await influticsApiRequest.call(
    this,
    'GET',
    `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`,
    undefined,
    qs,
  );
  returnData.push({ json: response });
}
else if (operation === 'updateByExternalId') {
  const externalId = this.getNodeParameter('externalId', i) as string;
  const platform = this.getNodeParameter('platform', i) as string;
  const { notes, campaign, status, tags } = this.getNodeParameter(
    'updateFields',
    i,
    {} as { notes?: string; campaign?: string; status?: string; tags?: string[] },
  ) as { notes?: string; campaign?: string; status?: string; tags?: string[] };
  const body: IDataObject = {};
  if (notes) body.notes = notes;
  if (campaign) body.campaign = campaign;
  if (status) body.status = status;
  if (tags?.length) body.tags = tags;
  const qs = platform ? { platform } : undefined;
  const response = await influticsApiRequest.call(
    this,
    'PATCH',
    `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`,
    body,
    qs,
  );
  returnData.push({ json: response });
}
```

(The `id`, `externalId`, `platform`, and `updateFields` `INodeProperties` blocks for these operations were already added in Task 5 Step 3's full `properties` array — Task 6 only extends the execute handler.)

- [ ] **Step 4: Run tests — confirm pass**

Run: `npx vitest run __tests__/InfluticsVideo.test.ts`
Expected: PASS — all tests including the new three.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsVideo.node.ts __tests__/InfluticsVideo.test.ts && git commit -m "feat(video): implement Get By ID, Get By External ID, Update By External ID

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: InfluticsBlogger node — Track + Get Job + By Username

**Files:**
- Test: `__tests__/InfluticsBlogger.test.ts`
- Create: `nodes/InfluticsBlogger.node.ts`

- [ ] **Step 1: Write failing tests in `__tests__/InfluticsBlogger.test.ts`**

Three describe blocks (mirroring Task 4's pattern):

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeInfluticsBlogger } from '../nodes/InfluticsBlogger.node';

const BASE_URL = 'https://api.influtics.com';

function makeCtx(params: Record<string, any>) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => params[name]);
  ctx.helpers = {
    requestWithAuthentication: vi.fn(async (_name, opts) => {
      const res = await fetch((opts as any).url, {
        method: (opts as any).method,
        headers: (opts as any).headers,
        body: (opts as any).body ? JSON.stringify((opts as any).body) : undefined,
      });
      return { statusCode: res.status, headers: {}, body: await res.text() };
    }),
  } as any;
  return ctx;
}

describe('InfluticsBlogger node — Track', () => {
  afterEach(() => nock.cleanAll());
  it('POSTs {platform, username} and returns job_id', async () => {
    const ctx = makeCtx({ operation: 'track', platform: 'tiktok', username: 'alice' });
    nock(BASE_URL).post('/v1/bloggers/track', { platform: 'tiktok', username: 'alice' }).reply(202, {
      success: true,
      data: { job_id: 'job-abc' },
    });
    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.job_id).toBe('job-abc');
  });
});

describe('InfluticsBlogger node — Get Job', () => {
  afterEach(() => nock.cleanAll());
  it('GETs /v1/bloggers/jobs/{job_id}', async () => {
    const ctx = makeCtx({ operation: 'getJob', jobId: 'job-abc' });
    nock(BASE_URL).get('/v1/bloggers/jobs/job-abc').reply(200, {
      success: true,
      data: { state: 'succeeded', result: { tracked: true } },
    });
    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.state).toBe('succeeded');
  });

  it('surfaces 410 JOB_TIMEOUT', async () => {
    const ctx = makeCtx({ operation: 'getJob', jobId: 'job-stuck' });
    nock(BASE_URL).get('/v1/bloggers/jobs/job-stuck').reply(410, {
      success: false,
      error: { code: 'JOB_TIMEOUT', message: 'Job did not complete in time' },
    });
    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /JOB_TIMEOUT/,
    );
  });
});

describe('InfluticsBlogger node — By Username', () => {
  afterEach(() => nock.cleanAll());
  it('GETs /v1/bloggers/by-username/{username}', async () => {
    const ctx = makeCtx({ operation: 'byUsername', username: 'alice', platform: 'tiktok' });
    nock(BASE_URL)
      .get('/v1/bloggers/by-username/alice')
      .query({ platform: 'tiktok' })
      .reply(200, { success: true, data: { username: 'alice', followers: 1000 } });
    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.followers).toBe(1000);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx vitest run __tests__/InfluticsBlogger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `nodes/InfluticsBlogger.node.ts`**

```typescript
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from './GenericFunctions';

export async function executeInfluticsBlogger(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    if (operation === 'track') {
      const platform = this.getNodeParameter('platform', i) as string;
      const username = this.getNodeParameter('username', i) as string;
      const response = await influticsApiRequest.call(this, 'POST', '/v1/bloggers/track', {
        platform,
        username,
      });
      returnData.push({ json: response });
    } else if (operation === 'getJob') {
      const jobId = this.getNodeParameter('jobId', i) as string;
      const response = await influticsApiRequest.call(
        this,
        'GET',
        `/v1/bloggers/jobs/${encodeURIComponent(jobId)}`,
      );
      returnData.push({ json: response });
    } else if (operation === 'byUsername') {
      const username = this.getNodeParameter('username', i) as string;
      const platform = this.getNodeParameter('platform', i) as string;
      const qs = platform ? { platform } : undefined;
      const response = await influticsApiRequest.call(
        this,
        'GET',
        `/v1/bloggers/by-username/${encodeURIComponent(username)}`,
        undefined,
        qs,
      );
      returnData.push({ json: response });
    } else {
      throw new Error(`Operation "${operation}" not implemented in InfluticsBlogger`);
    }
  }
  return [returnData];
}

export class InfluticsBlogger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Blogger',
    name: 'influticsBlogger',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Track and read Influtics bloggers (creators)',
    defaults: { name: 'Influtics Blogger' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Track', value: 'track', description: 'Start a track-creator job (async)' },
          { name: 'Get Job', value: 'getJob', description: 'Poll a track-creator job by ID' },
          { name: 'By Username', value: 'byUsername', description: 'Look up a tracked creator' },
        ],
        default: 'track',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['track', 'byUsername'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'VK', value: 'vk' },
        ],
        default: 'tiktok',
      },
      {
        displayName: 'Username',
        name: 'username',
        type: 'string',
        displayOptions: { show: { operation: ['track', 'byUsername'] } },
        default: '',
      },
      {
        displayName: 'Job ID',
        name: 'jobId',
        type: 'string',
        displayOptions: { show: { operation: ['getJob'] } },
        default: '',
        description: 'Job ID returned by the Track operation',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsBlogger.call(this, this.getInputData());
  }
}
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `npx vitest run __tests__/InfluticsBlogger.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsBlogger.node.ts __tests__/InfluticsBlogger.test.ts && git commit -m "feat(blogger): implement Track, Get Job, By Username operations

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: InfluticsTrend node — Search

**Files:**
- Test: `__tests__/InfluticsTrend.test.ts`
- Create: `nodes/InfluticsTrend.node.ts`

- [ ] **Step 1: Write failing tests in `__tests__/InfluticsTrend.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeInfluticsTrend } from '../nodes/InfluticsTrend.node';

const BASE_URL = 'https://api.influtics.com';

describe('InfluticsTrend node — Search', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'search',
        keyword: 'fyp',
        platform: 'tiktok',
      };
      return map[name];
    });
    ctx.helpers = {
      requestWithAuthentication: vi.fn(async (_name, opts) => {
        const res = await fetch((opts as any).url, {
          method: (opts as any).method,
          headers: (opts as any).headers,
        });
        return { statusCode: res.status, headers: {}, body: await res.text() };
      }),
    } as any;
  });

  afterEach(() => nock.cleanAll());

  it('GETs /v1/trends/search with keyword + platform', async () => {
    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fyp', platform: 'tiktok' })
      .reply(200, { success: true, data: [{ keyword: 'fyp', volume: 9000 }] });
    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].volume).toBe(9000);
  });
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `npx vitest run __tests__/InfluticsTrend.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `nodes/InfluticsTrend.node.ts`**

```typescript
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from './GenericFunctions';

export async function executeInfluticsTrend(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const returnData: INodeExecutionData[] = [];
  for (let i = 0; i < items.length; i++) {
    const keyword = this.getNodeParameter('keyword', i) as string;
    const platform = this.getNodeParameter('platform', i) as string;
    const response = await influticsApiRequest.call(
      this,
      'GET',
      '/v1/trends/search',
      undefined,
      { keyword, platform } as IDataObject,
    );
    returnData.push({ json: response });
  }
  return [returnData];
}

export class InfluticsTrend implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Trend',
    name: 'influticsTrend',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Search Influtics trends by keyword',
    defaults: { name: 'Influtics Trend' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      { displayName: 'Keyword', name: 'keyword', type: 'string', default: '', required: true },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'YouTube', value: 'youtube' },
        ],
        default: 'tiktok',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsTrend.call(this, this.getInputData());
  }
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run __tests__/InfluticsTrend.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsTrend.node.ts __tests__/InfluticsTrend.test.ts && git commit -m "feat(trend): implement InfluticsTrend Search operation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: InfluticsAccount node — Get Usage + Get Limits

**Files:**
- Test: `__tests__/InfluticsAccount.test.ts`
- Create: `nodes/InfluticsAccount.node.ts`

- [ ] **Step 1: Write failing tests in `__tests__/InfluticsAccount.test.ts`**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeInfluticsAccount } from '../nodes/InfluticsAccount.node';

const BASE_URL = 'https://api.influtics.com';

function makeCtx(operation: string) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => (name === 'operation' ? operation : undefined));
  ctx.helpers = {
    requestWithAuthentication: vi.fn(async (_name, opts) => {
      const res = await fetch((opts as any).url, { method: (opts as any).method, headers: (opts as any).headers });
      return { statusCode: res.status, headers: {}, body: await res.text() };
    }),
  } as any;
  return ctx;
}

describe('InfluticsAccount node — Get Usage', () => {
  afterEach(() => nock.cleanAll());
  it('GETs /v1/account/usage', async () => {
    const ctx = makeCtx('getUsage');
    nock(BASE_URL).get('/v1/account/usage').reply(200, {
      success: true,
      data: { month_to_date: { credits: 1234 } },
    });
    const out = await executeInfluticsAccount.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.month_to_date.credits).toBe(1234);
  });
});

describe('InfluticsAccount node — Get Limits', () => {
  afterEach(() => nock.cleanAll());
  it('GETs /v1/account/limits', async () => {
    const ctx = makeCtx('getLimits');
    nock(BASE_URL).get('/v1/account/limits').reply(200, {
      success: true,
      data: { tier: 'pro', per_minute: 60 },
    });
    const out = await executeInfluticsAccount.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.tier).toBe('pro');
  });
});
```

- [ ] **Step 2: Run — confirm fail**

Run: `npx vitest run __tests__/InfluticsAccount.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `nodes/InfluticsAccount.node.ts`**

```typescript
import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from './GenericFunctions';

export async function executeInfluticsAccount(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const returnData: INodeExecutionData[] = [];
  for (let i = 0; i < items.length; i++) {
    const path = operation === 'getUsage' ? '/v1/account/usage' : '/v1/account/limits';
    const response = await influticsApiRequest.call(this, 'GET', path);
    returnData.push({ json: response });
  }
  return [returnData];
}

export class InfluticsAccount implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Account',
    name: 'influticsAccount',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Read Influtics account usage and limits',
    defaults: { name: 'Influtics Account' },
    inputs: ['main'],
    outputs: ['main'],
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Get Usage', value: 'getUsage' },
          { name: 'Get Limits', value: 'getLimits' },
        ],
        default: 'getUsage',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsAccount.call(this, this.getInputData());
  }
}
```

- [ ] **Step 4: Run — confirm pass**

Run: `npx vitest run __tests__/InfluticsAccount.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/InfluticsAccount.node.ts __tests__/InfluticsAccount.test.ts && git commit -m "feat(account): implement Get Usage and Get Limits operations

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Icon asset

**Files:**
- Create: `nodes/influtics.svg`

n8n references `icon: 'file:influtics.svg'` in each node description. The icon must exist as a static file.

- [ ] **Step 1: Add a placeholder Influtics icon**

Save a 60×60 SVG to `nodes/influtics.svg` using the brand color `#6266F0`. (The Influtics design team will replace this with the official node icon in a follow-up PR.)

Minimal starter SVG:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
  <rect width="60" height="60" rx="12" fill="#6266F0"/>
  <text x="30" y="38" font-family="Helvetica,Arial,sans-serif" font-size="22" font-weight="700"
        fill="#FFFFFF" text-anchor="middle">I</text>
</svg>
```

- [ ] **Step 2: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add nodes/influtics.svg && git commit -m "feat(brand): add Influtics node icon placeholder

60x60 SVG in brand color #6266F0. The Influtics design team will replace
this with the official node icon in a follow-up PR.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Build, lint, full test suite

**Files:** (none modified — verification pass)

The package now has all source code and tests. Run the full pipeline to verify it builds. Version bump + CHANGELOG finalization are deferred to Task 13 — going straight `0.1.0 → 1.0.0` in a single release avoids a wasted intermediate `0.2.0` tag (bad SemVer: pre-1.0.0 → 1.0.0 is itself a major bump that signals API stability).

- [ ] **Step 1: Run lint**

Run: `npm run lint`
Expected: exits 0 with no errors.

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: all tests pass — `GenericFunctions (6: mapInfluticsError×2 + influticsApiRequest×2 + paginator×2) + Video (6: Track×2 + Get Stats + Get By ID + Get By External ID + Update By External ID) + Blogger (4) + Trend (1) + Account (2) = 19 tests`.

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: produces `dist/` with `nodes/InfluticsVideo.node.js`, `nodes/InfluticsBlogger.node.js`, `nodes/InfluticsTrend.node.js`, `nodes/InfluticsAccount.node.js`, `credentials/InfluticsApi.credentials.js`.

- [ ] **Step 4: Verify build output**

Run: `ls dist/nodes/ && ls dist/credentials/`
Expected: four `.node.js` files + one `.credentials.js` file.

---

## Task 12: README — full operations + install instructions

**Files:**
- Modify: `README.md`

The bootstrap README is sparse. Replace it with a full operations table + install + auth + troubleshooting.

- [ ] **Step 1: Write the full README**

```markdown
# n8n-nodes-influtics

Official [Influtics](https://influtics.com) integration for [n8n](https://n8n.io) — track influencer videos, bloggers, and trends across TikTok, Instagram, YouTube, VK, and more.

## Install

1. In n8n, open **Settings → Community Nodes**.
2. Click **Install a community node**.
3. Enter `n8n-nodes-influtics` and confirm.

After install, configure the **Influtics API** credential with your API key from the Influtics dashboard under **Settings → API**.

## Operations

### Influtics Video

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Track | `POST` | `/v1/videos/track` |
| Get Stats | `GET` | `/v1/videos/stats` |
| Get By ID | `GET` | `/v1/videos/by-id/{id}` |
| Get By External ID | `GET` | `/v1/videos/by-external-id/{id}` |
| Update By External ID | `PATCH` | `/v1/videos/by-external-id/{id}` |

### Influtics Blogger

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Track | `POST` | `/v1/bloggers/track` (returns `job_id`) |
| Get Job | `GET` | `/v1/bloggers/jobs/{job_id}` |
| By Username | `GET` | `/v1/bloggers/by-username/{username}` |

The **Track** operation is async; pair it with **Get Job** using the expression `{{ $json.job_id }}` in the next workflow step.

### Influtics Trend

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Search | `GET` | `/v1/trends/search` |

### Influtics Account

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Get Usage | `GET` | `/v1/account/usage` |
| Get Limits | `GET` | `/v1/account/limits` |

## Errors

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | API key is missing or invalid. |
| `PAID_PLAN_REQUIRED` | This endpoint requires a paid subscription. Upgrade at the URL surfaced in the error description. |
| `BLOGGER_NOT_TRACKED` | Creator isn't tracked by your org — run **Influtics Blogger → Track** first. |
| `JOB_TIMEOUT` | The async job didn't complete in time — poll again or retry. |
| `VALIDATION_ERROR` | A required field is missing or invalid. |

## License

MIT — see [LICENSE](LICENSE).
```

- [ ] **Step 2: Commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add README.md && git commit -m "docs(readme): full operations + install + errors section

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: npm publish prep

**Files:**
- Modify: `package.json#version` (bump to `1.0.0`)
- Modify: `CHANGELOG.md` (add `[1.0.0]` entry)

Now that the code is ready, the final version bump is to `1.0.0` for the public community-node release.

- [ ] **Step 1: Bump version to `1.0.0`**

In `package.json`, set `"version": "1.0.0"`.

- [ ] **Step 2: Add `1.0.0` entry to CHANGELOG.md**

```markdown
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
```

- [ ] **Step 3: Run lint + test + build one more time as the final gate**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && npm run lint && npm test && npm run build
```
Expected: all three exit 0, build artifacts present.

- [ ] **Step 4: Verify package contents**

Run: `npm pack --dry-run`
Expected: prints a tarball listing showing `dist/nodes/*.node.js`, `dist/credentials/*.credentials.js`, `package.json`, `README.md`, `LICENSE`. No source `.ts` files (they should be compiled to `dist/`).

- [ ] **Step 5: Tag the release locally**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git add package.json CHANGELOG.md && git commit -m "chore(release): v1.0.0 — first public community-node release

Co-Authored-By: Claude <noreply@anthropic.com>" && git tag -a v1.0.0 -m "v1.0.0 — first public community-node release"
```

- [ ] **Step 6: Push tag and commit**

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && git push origin main --follow-tags
```
Expected: push succeeds; tag `v1.0.0` is visible on GitHub at `https://github.com/Influtics/n8n-nodes-influtics/releases/tag/v1.0.0`.

**STOP — DO NOT RUN `npm publish`.** The user must run it manually with their own 2FA-protected npm account so the package is published under their identity. The user runs:

```bash
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && npm login   # if not already
cd /Users/ivanabramov/Desktop/n8n\ x\ Influtics && npm publish --access public
```

After publish:
- Verify the package is live: https://www.npmjs.com/package/n8n-nodes-influtics
- Install in n8n by name: Settings → Community Nodes → Install `n8n-nodes-influtics`.
- Smoke-test in n8n by creating an Influtics Video → Track node with a real API key.

---

## Task 14: Apply for verified-nodes partner program (post-v1.0.0)

**Files:**
- Modify: `README.md` (add "Verified" badge once accepted)

Once `n8n-nodes-influtics@1.0.0` is live and has a few hundred installs, apply for n8n's verified-nodes program.

- [ ] **Step 1: Apply via https://n8n.io/integrations/become-a-partner/**

The user fills out the partner form (requires vendor agreement with n8n). This task is a marker for the follow-up — no code change.

- [ ] **Step 2: Once accepted, update README**

Add a badge + short note linking to the n8n integrations page. Commit.

---

## Out of scope (explicit non-goals)

- **Webhook trigger node** — requires backend support on Influtics; not in the public API today.
- **Multi-org credential** — one API key = one org; users with multiple orgs add multiple credentials.
- **Custom base URL** — v1 hard-codes `https://api.influtics.com`.
- **Pagination beyond native API support** — endpoints that don't paginate today return a single page; if the API adds pagination, follow-up PRs add cursor helpers.