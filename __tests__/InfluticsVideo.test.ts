import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeInfluticsVideo } from '../nodes/InfluticsVideo/InfluticsVideo.node';

const BASE_URL = 'https://api.influtics.com';

describe('InfluticsVideo node — Track operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeAll(() => {
    // Block real network so accidental unmocked calls fail loudly.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getNode = vi
      .fn()
      .mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
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
      // Mirror n8n's real `httpRequestWithAuthentication` with `json: true`:
      //   - 2xx → returns the parsed JSON body directly
      //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
      // GenericFunctions.mapInfluticsError reads `rawError.response.body.error`.
      // Falls back from `uri` → `url` because GenericFunctions uses `url` but some
      // n8n internals normalise to `uri`.
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
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('POSTs urls array to /v1/videos/track and returns parsed response', async () => {
    nock(BASE_URL)
      .post('/v1/videos/track', {
        urls: ['https://tiktok.com/@a/video/1', 'https://tiktok.com/@b/video/2'],
      })
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

  it('rejects empty urls with a clear NodeOperationError WITHOUT hitting the API', async () => {
    // Override only the urls parameter; everything else stays from beforeEach.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'track',
        urls: { urls: [] },
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Provide at least one video URL/,
    );
    // Critical assertion: an empty URL list must NEVER reach the API.
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('fires the Track API exactly ONCE per workflow run regardless of input item count', async () => {
    // Swap in a pure vi.fn().mockResolvedValue so we can assert call count
    // without hitting nock/fetch.
    ctx.helpers.httpRequestWithAuthentication = vi
      .fn()
      .mockResolvedValue({ success: true, data: { tracked: 3, skipped: 0 } }) as any;

    // 3 input items — Track is a batch op so we must fire once, not thrice.
    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsVideo.call(ctx as any, items);

    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(1);
    expect(out[0]).toEqual([{ json: { success: true, data: { tracked: 3, skipped: 0 } } }]);
  });

  it('falls back to API_ERROR prefix when a 401 response has no error.code', async () => {
    nock(BASE_URL)
      .post('/v1/videos/track')
      .reply(401, {
        success: false,
        // Deliberately no `error.code` — exercises the mapInfluticsError fallback
        // where the code slot is undefined and the prefix becomes "API_ERROR".
        error: { message: 'Token rejected' },
      });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /^API_ERROR: Token rejected/,
    );
  });

  it('rejects non-array urls payload without hitting the API', async () => {
    // Defends the structural cast: even if n8n somehow returns a non-array
    // (custom UI bug, schema drift), the executor must fail fast, not 400.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'track',
        urls: { urls: 'https://tiktok.com/@a/video/1' as any },
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });
});

describe('InfluticsVideo node — Get Stats operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getNode = vi
      .fn()
      .mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: 'tiktok',
        status: 'active',
        blogger_username: '@alice',
        sort: 'views',
        order: 'desc',
        returnAll: false,
        limit: 50,
      };
      return map[name];
    });
    ctx.helpers = {
      // Mirror n8n's real `httpRequestWithAuthentication` with `json: true`:
      //   - 2xx → returns the parsed JSON body directly
      //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
      // Falls back from `uri` → `url` because GenericFunctions uses `url` but some
      // n8n internals normalise to `uri`. Serializes `qs` onto the URL so nock's
      // `.query(...)` matchers see the same path the production http helper would
      // hit (request lib does the same — append qs to URL).
      httpRequestWithAuthentication: vi.fn(async (_name, opts) => {
        let url = (opts as any).uri ?? (opts as any).url;
        const qs = (opts as any).qs;
        if (qs && typeof qs === 'object') {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(qs)) {
            if (Array.isArray(v)) {
              for (const item of v) {
                if (item !== undefined && item !== null) sp.append(k, String(item));
              }
            } else if (v !== undefined && v !== null && v !== '') {
              sp.append(k, String(v));
            }
          }
          const qsStr = sp.toString();
          if (qsStr) url += `?${qsStr}`;
        }
        const res = await fetch(url, {
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
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/videos/stats with platform/status/blogger_username/sort/order as query string', async () => {
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query({
        platform: 'tiktok',
        status: 'active',
        blogger_username: '@alice',
        sort: 'views',
        order: 'desc',
        limit: 50,
      })
      .reply(200, {
        success: true,
        data: {
          data: [{ video_id: 'v1', views: 12345 }],
          pagination: { total: 1, limit: 50, offset: 0, has_more: false },
        },
        meta: {},
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    // The API envelope nests items under `data.data`; the executor returns
    // the raw envelope, so the n8n output mirrors what the API sent.
    expect(out[0][0].json.data.data[0].views).toBe(12345);
    // Verify the executor's qs payload too — guards against silent drift where
    // the URL is right but the helper stops spreading it.
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({
      platform: 'tiktok',
      status: 'active',
      blogger_username: '@alice',
      sort: 'views',
      order: 'desc',
      limit: 50,
    });
  });

  it('paginates via offset + has_more when returnAll is true', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: '',
        status: '',
        blogger_username: '',
        sort: '',
        order: '',
        returnAll: true,
        limit: 2,
      };
      return map[name];
    });

    // The real API returns items under data.data and pagination under
    // data.pagination. Page 1 reports has_more: true with offset 0; page 2
    // returns has_more: false (no more rows).
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query((actual: Record<string, unknown>) =>
        actual.limit === '2' && actual.offset === '0',
      )
      .reply(200, {
        success: true,
        data: {
          data: [{ video_id: 'v1' }, { video_id: 'v2' }],
          pagination: { total: 3, limit: 2, offset: 0, has_more: true },
        },
        meta: {},
      });
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query((actual: Record<string, unknown>) =>
        actual.limit === '2' && actual.offset === '2',
      )
      .reply(200, {
        success: true,
        data: {
          data: [{ video_id: 'v3' }],
          pagination: { total: 3, limit: 2, offset: 2, has_more: false },
        },
        meta: {},
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    // The executor aggregates the pages and wraps them under { data: [...] }
    // so the downstream n8n node sees one item per video.
    expect(out[0][0].json.data).toEqual([
      { video_id: 'v1' },
      { video_id: 'v2' },
      { video_id: 'v3' },
    ]);
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(2);
    // The second call must have advanced the offset (no cursor — offset walk).
    const secondCallQs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[1][1].qs;
    expect(secondCallQs.offset).toBe(2);
  });

  it('sends a single call with default limit=50 and platform=tiktok when returnAll is false', async () => {
    // Override defaults explicitly: the test asserts the exact qs the executor
    // sends when the caller hasn't typed a limit.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: 'tiktok',
        status: '',
        blogger_username: '',
        sort: '',
        order: '',
        returnAll: false,
        limit: 50,
      };
      return map[name];
    });

    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query((actual: Record<string, unknown>) => {
        if (actual.platform !== 'tiktok') return false;
        if (actual.limit !== '50') return false;
        // offset must be absent or 0 — handler does not set qs.offset for the
        // single-call branch (server defaults to 0).
        if (actual.offset !== undefined && actual.offset !== '0') return false;
        return true;
      })
      .reply(200, {
        success: true,
        data: {
          data: [{ video_id: 'v1' }],
          pagination: { total: 1, limit: 50, offset: 0, has_more: false },
        },
        meta: {},
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.data[0].video_id).toBe('v1');
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(1);
  });

  // v1.0.11 widened the getStats `platform` dropdown from 4 (tiktok/instagram/
  // youtube/vk) to all 9 platforms the Influtics video-tracking surface accepts.
  // Each new platform must round-trip the same way the existing tiktok test does:
  // the chosen value flows through `qs.platform` exactly as typed, and the API
  // envelope comes back untouched. These tests fail loud if a future refactor
  // drops a platform from VIDEO_PLATFORMS or routes a platform through qs
  // with a different key.
  const newPlatforms = ['pinterest', 'threads', 'telegram', 'ok', 'dzen'] as const;
  for (const platform of newPlatforms) {
    it(`forwards platform=${platform} as qs.platform to /v1/videos/stats`, async () => {
      ctx.getNodeParameter = vi.fn((name: string) => {
        const map: Record<string, any> = {
          operation: 'getStats',
          platform,
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
          returnAll: false,
          limit: 50,
        };
        return map[name];
      });

      nock(BASE_URL)
        .get('/v1/videos/stats')
        .query((actual: Record<string, unknown>) => actual.platform === platform)
        .reply(200, {
          success: true,
          data: {
            data: [{ video_id: `v-${platform}` }],
            pagination: { total: 1, limit: 50, offset: 0, has_more: false },
          },
          meta: {},
        });

      const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
      expect(out[0][0].json.data.data[0].video_id).toBe(`v-${platform}`);
      const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
      expect(callArgs.qs.platform).toBe(platform);
    });
  }

  it('clamps `limit` to the API hard cap of 100 when the caller passes 999', async () => {
    // Simulates "user typed 999": the executor's defensive Math.min(limit, 100)
    // must clamp before forwarding. The UI's `typeOptions.maxValue = 100`
    // would normally prevent this, but we assert handler-side coercion as
    // defense-in-depth against custom callers / future schema drift.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: '',
        status: '',
        blogger_username: '',
        sort: '',
        order: '',
        returnAll: false,
        limit: 999,
      };
      return map[name];
    });

    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query({ limit: 100 })
      .reply(200, {
        success: true,
        data: {
          data: [],
          pagination: { total: 0, limit: 100, offset: 0, has_more: false },
        },
        meta: {},
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    // Single-call branch returns the raw envelope, so data.data is the items
    // array and is empty here.
    expect(out[0][0].json.data.data).toEqual([]);
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({ limit: 100 });
  });
});

describe('InfluticsVideo node — Get By ID operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getNode = vi
      .fn()
      .mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
    ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
    ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = { operation: 'getById', id: 'abc-123' };
      return map[name];
    });
    ctx.helpers = {
      // Same shape as the Track describe block — no qs needed for getById.
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
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/videos/by-id/{id} with no query string', async () => {
    nock(BASE_URL)
      .get('/v1/videos/by-id/abc-123')
      .reply(200, { success: true, data: { id: 'abc-123', views: 42 } });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.id).toBe('abc-123');
    expect(out[0][0].json.data.views).toBe(42);
    // Backend (handleGetVideoById) does NOT read any query params — guard
    // against accidental drift that would put `?platform=...` or similar
    // on the wire.
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
  });

  it('rejects empty id with a NodeOperationError WITHOUT hitting the API', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = { operation: 'getById', id: '' };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Video ID is required/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('surfaces a 404 VIDEO_NOT_FOUND response to the caller', async () => {
    nock(BASE_URL)
      .get('/v1/videos/by-id/abc-123')
      .reply(404, { success: false, error: { code: 'VIDEO_NOT_FOUND', message: 'Video not found' } });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /VIDEO_NOT_FOUND/,
    );
  });
});

describe('InfluticsVideo node — Get By External ID operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getNode = vi
      .fn()
      .mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
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
      // Same shape as the Track describe block — qs not used by getByExternalId
      // (the backend queries by (organization_id, external_video_id) only).
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
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/videos/by-external-id/{id} with NO query string (backend ignores platform)', async () => {
    // The backend (handleGetVideoByExternalId) reads ONLY external_video_id from
    // the path. The (organization_id, external_video_id) partial unique index
    // already scopes the row — platform on the wire is cruft. The UI keeps the
    // `platform` dropdown as a hint for users, but we don't forward it.
    nock(BASE_URL)
      .get('/v1/videos/by-external-id/ext-1')
      .reply(200, { success: true, data: { external_id: 'ext-1', views: 99 } });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.external_id).toBe('ext-1');
    expect(out[0][0].json.data.views).toBe(99);
    // Belt-and-braces: query string must be absent even though the UI
    // collected `platform=tiktok`.
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
  });

  it('rejects empty externalId with a NodeOperationError WITHOUT hitting the API', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getByExternalId',
        externalId: '',
        platform: 'tiktok',
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects missing platform with a NodeOperationError WITHOUT hitting the API', async () => {
    // The backend doesn't require platform, but the UI marks it required and
    // it's a useful user-facing hint. Defensive guard keeps workflows honest.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getByExternalId',
        externalId: 'ext-1',
        platform: '',
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  // v1.0.11 widened the `platform` dropdown on getByExternalId / updateByExternalId
  // to all 9 platforms. The backend still scopes these lookups by the
  // (organization_id, external_video_id) unique index and IGNORES the `platform`
  // field — see InfluticsVideo.node.ts:140-149 (the by-external-id comment block).
  // This locks the invariant in for every supported platform: no qs leak, no body
  // leak, regardless of which dropdown value the caller picked.
  const allPlatforms = [
    'dzen',
    'instagram',
    'ok',
    'pinterest',
    'telegram',
    'threads',
    'tiktok',
    'vk',
    'youtube',
  ] as const;
  for (const platform of allPlatforms) {
    it(`does NOT forward platform=${platform} on /v1/videos/by-external-id (backend ignores it)`, async () => {
      ctx.getNodeParameter = vi.fn((name: string) => {
        const map: Record<string, any> = {
          operation: 'getByExternalId',
          externalId: 'ext-1',
          platform,
        };
        return map[name];
      });

      nock(BASE_URL)
        .get('/v1/videos/by-external-id/ext-1')
        .reply(200, { success: true, data: { external_id: 'ext-1', views: 1 } });

      await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
      const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
      expect(callArgs.qs).toBeUndefined();
      expect(callArgs.body).toBeUndefined();
      // Belt-and-braces: the URL nock matched must NOT contain `?platform=`.
      // nock would have 404'd the matcher if it did, but assert explicitly.
      expect(callArgs.url).not.toMatch(/[?&]platform=/);
    });
  }
});

describe('InfluticsVideo node — Update By External ID operation', () => {
  let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;

  beforeEach(() => {
    ctx = mockDeep<IExecuteFunctions>();
    ctx.getNode = vi
      .fn()
      .mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
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
      // Same shape as the Track describe block — body is JSON-stringified so
      // nock's `.patch(path, body)` matcher can deep-equal the parsed JSON.
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
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('PATCHes /v1/videos/by-external-id/{id} with only the fields the caller set', async () => {
    // Backend (handlePatchVideoByExternalId) accepts notes, budget, campaign,
    // video_status, status, tags. The UI exposes a subset (notes, campaign,
    // status, tags). The executor must:
    //   - coerce string fields with non-empty length
    //   - coerce tags only when it's a non-empty array
    //   - omit empty/falsy values entirely (never send `campaign: ""`)
    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1', {
        notes: 'follow up',
        campaign: 'aug',
        status: 'running',
        tags: ['urgent'],
      })
      .reply(200, {
        success: true,
        data: {
          video_id: 'internal-uuid',
          external_video_id: 'ext-1',
          updated_fields: ['notes', 'campaign_tag', 'status', 'tags'],
          tags_result: { matched: ['urgent'], created: [] },
        },
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.updated_fields).toEqual([
      'notes',
      'campaign_tag',
      'status',
      'tags',
    ]);
    // Backend does not read platform — guard against accidental qs.
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
  });

  it('omits empty update fields from the body (no `campaign: ""` cruft)', async () => {
    // Caller set only `notes`. The executor must NOT send `campaign: ""`,
    // `status: ""`, or `tags: []` — those would be silently dropped server-side
    // but would mask user intent if the schema ever becomes strict.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
        updateFields: {
          notes: 'just notes',
          campaign: '',
          status: '',
          tags: [],
        },
      };
      return map[name];
    });

    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1', { notes: 'just notes' })
      .reply(200, {
        success: true,
        data: { video_id: 'internal-uuid', external_video_id: 'ext-1', updated_fields: ['notes'] },
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.updated_fields).toEqual(['notes']);
  });

  it('omits the default empty status from the body so users who only touch Notes do not clobber workflow state', async () => {
    // Regression test: previously updateFields.status defaulted to 'to do',
    // causing every Update run to overwrite status with 'to do'. Now defaults
    // to '' and the handler's filter drops it. Simulates the UI's new default.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
        // status: '' is the new UI default; campaign: '' / tags: [] are also defaults.
        updateFields: { notes: 'just notes', campaign: '', status: '', tags: [] },
      };
      return map[name];
    });

    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1', { notes: 'just notes' })
      .reply(200, { success: true, data: { video_id: 'ext-1' } });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.success).toBe(true);
    // The nock exact-body matcher would have failed if status or campaign had leaked.
  });

  it('forwards an explicit status value (not the empty default) when the user picks one from the dropdown', async () => {
    // If the user explicitly picks a status from the dropdown (non-empty), it
    // MUST reach the body. The filter only drops empty strings — explicit picks
    // are intentional.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
        updateFields: { notes: 'just notes', campaign: '', status: 'running', tags: [] },
      };
      return map[name];
    });

    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1', { notes: 'just notes', status: 'running' })
      .reply(200, {
        success: true,
        data: { video_id: 'internal-uuid', external_video_id: 'ext-1', updated_fields: ['notes', 'status'] },
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.updated_fields).toEqual(['notes', 'status']);
  });

  it('rejects empty updateFields with a NodeOperationError WITHOUT hitting the API', async () => {
    // Backend (handlePatchVideoByExternalId) requires at least one of the
    // editable fields — sending an empty body would 400. Fail fast with a
    // clear UI message instead of letting the workflow silently 400.
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: 'ext-1',
        platform: 'tiktok',
        updateFields: { notes: '', campaign: '', status: '', tags: [] },
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Provide at least one update field/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects empty externalId with a NodeOperationError WITHOUT hitting the API', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'updateByExternalId',
        externalId: '',
        platform: 'tiktok',
        updateFields: { notes: 'x' },
      };
      return map[name];
    });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('surfaces a 404 VIDEO_NOT_FOUND response to the caller', async () => {
    nock(BASE_URL)
      .patch('/v1/videos/by-external-id/ext-1')
      .reply(404, { success: false, error: { code: 'VIDEO_NOT_FOUND', message: 'Video not found' } });

    await expect(executeInfluticsVideo.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /VIDEO_NOT_FOUND/,
    );
  });

  // v1.0.11 mirrored the getByExternalId widening on updateByExternalId: all 9
  // platforms accepted by the dropdown, but the PATCH body still never carries
  // a `platform` field (backend ignores it). Each iteration uses a unique
  // externalId so the per-platform nock interceptors don't collide.
  const allPlatforms = [
    'dzen',
    'instagram',
    'ok',
    'pinterest',
    'telegram',
    'threads',
    'tiktok',
    'vk',
    'youtube',
  ] as const;
  for (const platform of allPlatforms) {
    it(`does NOT forward platform=${platform} on PATCH /v1/videos/by-external-id`, async () => {
      const ext = `ext-${platform}`;
      ctx.getNodeParameter = vi.fn((name: string) => {
        const map: Record<string, any> = {
          operation: 'updateByExternalId',
          externalId: ext,
          platform,
          updateFields: { notes: 'just notes', campaign: '', status: '', tags: [] },
        };
        return map[name];
      });

      nock(BASE_URL)
        .patch(`/v1/videos/by-external-id/${ext}`, { notes: 'just notes' })
        .reply(200, {
          success: true,
          data: { video_id: ext, external_video_id: ext, updated_fields: ['notes'] },
        });

      const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
      expect(out[0][0].json.success).toBe(true);
      const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
      expect(callArgs.qs).toBeUndefined();
      expect(callArgs.body).not.toHaveProperty('platform');
      expect(callArgs.url).not.toMatch(/[?&]platform=/);
    });
  }
});
