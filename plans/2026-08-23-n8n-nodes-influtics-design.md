# Official Influtics n8n Integration — Design

**Status:** Approved (brainstorming complete)
**Date:** 2026-08-23
**Author:** Claude (brainstorming session)
**Distribution path:** Community node now, verified-ready later

---

## 1. Context

Influtics is a paid product that exposes a public REST API for tracking influencers' videos, bloggers, and trends across platforms (TikTok, Instagram, YouTube, VK, etc.). The API is documented at `influtics.com/api-reference` and is consumed today by:

- The Influtics dashboard (React app) — uses JWT-authenticated internal endpoints.
- The Influtics MCP server — exposes the same REST surface as LLM-callable tools via OAuth.

n8n is a workflow automation tool with a mature ecosystem of community-built integrations (called "nodes"). A first-party Influtics integration lets users build automations such as:

- "When a new row lands in a Google Sheet, track that video URL in Influtics."
- "Every morning, fetch yesterday's tracked-video metrics into a Notion page."
- "When a Notion campaign tracker is marked Active, start tracking all creators in the campaign."

**Goal:** Ship an official Influtics n8n integration that wraps the full public API surface, is installable today as a community node, and meets the bar n8n requires for verified nodes so it can be promoted later.

## 2. Repository & distribution

**New standalone public repo:** `Influtics/n8n-nodes-influtics`

This follows n8n's strong convention that community/verified nodes live in their own repo, not a workspace of the vendor's main product. A separate repo:

- Keeps the closed-source dashboard codebase out of a public package surface.
- Allows independent versioning, changelog, and CI.
- Makes it easy for community contributors to fork.

**npm package:** `n8n-nodes-influtics`

- Published under the Influtics npm org.
- Keywords: `n8n`, `n8ncommunity`, `influtics`, `influencer-marketing`.
- `n8ncommunity` keyword is what makes it appear in the Community Nodes installer inside n8n.
- License: MIT (the standard for n8n community nodes).

**Distribution timeline:**

| Phase | What ships | Install path |
|-------|-----------|--------------|
| **v1.0.0 (immediate)** | Community node on npm | n8n → Settings → Community Nodes → Install `n8n-nodes-influtics` |
| **v1.x (later)** | Apply to n8n verified-nodes partner program (https://n8n.io/integrations/become-a-partner/) | Once accepted, listed under "Official" in n8n's integrations gallery, hosted by n8n, auto-updated |

The package structure designed here is the same one n8n accepts for verified nodes, so no rewrite is needed at promotion time.

## 3. Architecture

### 3.1 Repo layout

```
Influtics/n8n-nodes-influtics/
├── package.json                              # name: n8n-nodes-influtics, keywords: [n8ncommunity]
├── tsconfig.json
├── .eslintrc.js                              # extends n8n-nodes-base
├── .github/workflows/ci.yml                  # lint + test on PR
├── README.md                                 # install, credentials, operations, screenshots
├── CHANGELOG.md                              # follows Keep a Changelog format
├── LICENSE                                   # MIT
├── credentials/
│   └── InfluticsApi.credentials.ts           # "Influtics API" credential type
├── nodes/
│   ├── GenericFunctions.ts                   # shared HTTP transport + error mapper
│   ├── InfluticsVideo.node.ts                # 5 operations
│   ├── InfluticsBlogger.node.ts              # 3 operations
│   ├── InfluticsTrend.node.ts                # 1 operation
│   └── InfluticsAccount.node.ts              # 2 operations
└── __tests__/
    ├── InfluticsVideo.test.ts
    ├── InfluticsBlogger.test.ts
    ├── InfluticsTrend.test.ts
    ├── InfluticsAccount.test.ts
    └── GenericFunctions.test.ts
```

**One node per resource** was chosen over a single mega-node because it gives a cleaner n8n UI, maps 1:1 to the `videos/`, `bloggers/`, `trends/`, `account/` directory structure of the existing `api-reference/` docs, and lets new endpoints grow by adding operations (or a new node) without turning one node into a parameter zoo.

### 3.2 Credential

`InfluticsApi` credential type (single field):

```typescript
{
  name: 'influticsApi',
  displayName: 'Influtics API',
  properties: [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Get your API key from the Influtics dashboard under Settings → API.',
    },
  ],
  authenticate: {
    type: 'generic',
    properties: {
      headers: { Authorization: '=Bearer {{ $credentials.apiKey }}' },
    },
  },
}
```

Base URL is hard-coded to `https://api.influtics.com` (matches the production `api-worker` deployment; no environment-switching for v1).

### 3.3 GenericFunctions.ts

A shared helper imported by every node that owns:

- `influticsApiRequest(...)` — wraps `this.helpers.requestWithAuthentication()` with the Influtics base URL and content-type headers.
- `influticsApiRequestAllItems(...)` — pagination helper (the API supports cursor-based pagination on a few endpoints; for v1 only the endpoints that already paginate are wrapped, others return a single page).
- The error normalizer (`mapInfluticsError`) — turns an Axios error into a `NodeOperationError` carrying the API's `error.code`, `error.message`, and (when present) the full body under `description` so the n8n UI surfaces the upgrade URL from `PAID_PLAN_REQUIRED`.

### 3.4 Operations

Each node is structured `Resource → Operation` internally even though the node file is split by resource. For example, `InfluticsVideo.node.ts`:

| Operation (UI label) | Method + Path | n8n parameter group | Maps to docs |
|----------------------|---------------|---------------------|--------------|
| **Track** | `POST /v1/videos/track` | URLs (multi) | `api-reference/videos/track.md` |
| **Get Stats** | `GET /v1/videos/stats` | Filters (platform, campaign, blogger, dates, search, pagination) | `api-reference/videos/stats.md` |
| **Get By ID** | `GET /v1/videos/by-id/{id}` | ID | `api-reference/videos/by-id.md` |
| **Get By External ID** | `GET /v1/videos/by-external-id/{id}` | External ID + Platform | `api-reference/videos/by-external-id.md` |
| **Update By External ID** | `PATCH /v1/videos/by-external-id/{id}` | External ID + body fields (notes, budget, campaign, status, tags) | `api-reference/videos/update-by-external-id.md` |

`InfluticsBlogger.node.ts`:

| Operation | Method + Path | Notes |
|-----------|---------------|-------|
| **Track** | `POST /v1/bloggers/track` | Returns `202 Accepted` + `job_id`. User pairs with **Get Job** below. |
| **Get Job** | `GET /v1/bloggers/jobs/{job_id}` | Returns job state (`queued/processing/succeeded/error`) or `404`/`410 JOB_TIMEOUT`. |
| **By Username** | `GET /v1/bloggers/by-username/{username}` | Read-only creator lookup. |

`InfluticsTrend.node.ts`:

| Operation | Method + Path |
|-----------|---------------|
| **Search** | `GET /v1/trends/search` (keyword, platform, country, etc.) |

`InfluticsAccount.node.ts`:

| Operation | Method + Path |
|-----------|---------------|
| **Get Usage** | `GET /v1/account/usage` |
| **Get Limits** | `GET /v1/account/limits` |

### 3.5 Async blogger-track UX

`POST /v1/bloggers/track` is async (returns `202 Accepted` + `job_id`). The user's chosen pattern is to expose this as two separate nodes — no internal polling:

- `InfluticsBlogger → Track` returns the `job_id` as output.
- The workflow routes the `job_id` into the next step, which is `InfluticsBlogger → Get Job` configured with the **Job ID** parameter set to `{{ $json.job_id }}` (the expression referencing the previous node's output). Users who want repeated polling wrap that pair with n8n's built-in Schedule / Loop nodes. This is more composable than hiding polling inside one node.

Example two-node workflow (sketched in the README):

```
[InfluticsBlogger → Track] → outputs {job_id} → [InfluticsBlogger → Get Job (Job ID = {{ $json.job_id }})] → downstream consumer
```

### 3.6 Error handling

Every non-2xx is mapped to a `NodeOperationError` whose payload mirrors the API's standard error shape:

```json
{
  "code": "<api's error.code, e.g. PAID_PLAN_REQUIRED>",
  "message": "<api's error.message>",
  "request_id": "<api's request_id>"
}
```

Special cases:

- **402 `PAID_PLAN_REQUIRED`** — surfaced as a blocking error. The body (including `upgrade_url`) is attached under `error.description` so the upgrade URL is visible in the n8n UI without code-fishing. This is the user's chosen behavior — no soft-warning plumbing.
- **429** — surfaced as `NodeOperationError`. n8n's `requestWithAuthentication()` does NOT auto-retry by default; rely on the workflow-level "Retry on Error" setting. If we later need automatic backoff inside the node, configure it explicitly via the `request` helper options; for v1, document the workflow-level retry in the README.
- **410 `JOB_TIMEOUT`** — surfaced verbatim. Users decide whether to re-poll.
- **5xx** — surfaced verbatim. `Retry on Error` in workflow settings handles it.

## 4. Branding

- **Display names in the n8n node picker:** `Influtics`, `Influtics Video`, `Influtics Blogger`, `Influtics Trend`, `Influtics Account` (grouped by the `Influtics` prefix).
- **Icons:** SVG inline, 60×60px, color `#6266F0` (extracted from the Influtics design tokens; matches the primary brand color used in the dashboard and landing).
- **Group:** All nodes use `["transform"]` — they're data-fetch/transform operations, not triggers.

## 5. Testing

- **Vitest** + **nock** for HTTP mocking.
- One `__tests__/<Node>.test.ts` per node, covering:
  - 2xx success path (response shape).
  - 4xx error path (error message propagated to the operation result).
  - The 402 paywall case for at least one paid-plan endpoint.
- One `__tests__/GenericFunctions.test.ts` for the shared error mapper and transport.
- A `.github/workflows/ci.yml` runs `npm run lint && npm test` on every PR. Scripts (`lint`, `format`, `test`, `build`, `dev`) are inherited from the `n8n-node` CLI defaults scaffolded by `n8n-node new`; the CI step is the only place that needs explicit config.

## 6. Versioning & maintenance

- `package.json#version` is bumped on every merged change.
- **Semver:** major for breaking (removed endpoint, required field added to existing operation), minor for new operations or new optional fields, patch for fixes.
- `CHANGELOG.md` (Keep a Changelog format) is updated in the same PR.
- Releases are created from `main` after CI passes; `npm publish` happens from a release-tagged commit by the maintainer, never from a feature PR.
- **Contract:** when the public API adds a new endpoint, the integration gains a new operation in the same PR cycle. The README + the existing Influtics docs site (`/Users/ivanabramov/Desktop/Influtics docs/`) stay in lockstep with the package — the cross-repo sync lives in this section so future contributors know that any new operation here MUST be reflected in `api-reference/<resource>/<endpoint>.md` of the docs site, and vice versa.

## 7. Files & locations

- **Repo (new):** `github.com/Influtics/n8n-nodes-influtics`
- **npm:** `https://www.npmjs.com/package/n8n-nodes-influtics`
- **Installable from:** n8n Settings → Community Nodes → search "Influtics"
- **Marketing install instructions live in:** the public repo README + a short page on `influtics.com/integrations/n8n` (added in a follow-up website PR, not part of this spec).
- **Ownership:** maintained by the Influtics backend team. npm publish access and GitHub repo admin are scoped to the `@influtics-maintainers` GitHub team. New contributors open PRs from forks; only maintainers with publish rights tag releases. (Document the maintainer onboarding in `CONTRIBUTING.md` in a follow-up PR.)

## 8. Out of scope (v1)

- Webhook trigger (Influtics API does not expose webhooks today; would require backend work).
- Multi-org credential (one API key = one org; users with multiple orgs create multiple credentials).
- Custom base URL for staging/development (v1 targets production only).
- Pagination beyond what the API supports natively.

## 9. Open questions / follow-ups

- **Verified node application** — submit partner form once v1 has 1,000+ active installs or sooner if there's a relationship with n8n.
- **Icon final asset** — design should provide an official Influtics node icon (currently using the generic `#6266F0` placeholder).
- **Homepage banner** — once on the verified list, ask n8n to feature the integration.