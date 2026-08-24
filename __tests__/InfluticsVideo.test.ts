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
      // Mirror n8n's real `requestWithAuthentication` with `json: true`:
      //   - 2xx → returns the parsed JSON body directly
      //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
      // GenericFunctions.mapInfluticsError reads `rawError.response.body.error`.
      // Falls back from `uri` → `url` because GenericFunctions uses `url` but some
      // n8n internals normalise to `uri`.
      requestWithAuthentication: vi.fn(async (_name, opts) => {
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
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('fires the Track API exactly ONCE per workflow run regardless of input item count', async () => {
    // Swap in a pure vi.fn().mockResolvedValue so we can assert call count
    // without hitting nock/fetch.
    ctx.helpers.requestWithAuthentication = vi
      .fn()
      .mockResolvedValue({ success: true, data: { tracked: 3, skipped: 0 } }) as any;

    // 3 input items — Track is a batch op so we must fire once, not thrice.
    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsVideo.call(ctx as any, items);

    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(1);
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
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
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
      // Mirror n8n's real `requestWithAuthentication` with `json: true`:
      //   - 2xx → returns the parsed JSON body directly
      //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
      // Falls back from `uri` → `url` because GenericFunctions uses `url` but some
      // n8n internals normalise to `uri`. Serializes `qs` onto the URL so nock's
      // `.query(...)` matchers see the same path the production http helper would
      // hit (request lib does the same — append qs to URL).
      requestWithAuthentication: vi.fn(async (_name, opts) => {
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
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
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
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(2);
    // The second call must have advanced the offset (no cursor — offset walk).
    const secondCallQs = (ctx.helpers.requestWithAuthentication as any).mock.calls[1][1].qs;
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
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(1);
  });

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
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({ limit: 100 });
  });
});
