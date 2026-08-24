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
        platform: ['tiktok'],
        campaign: 'aug',
        blogger: '@alice',
        search: 'fyp',
        publishedFrom: '2026-08-01',
        publishedTo: '2026-08-23',
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

  it('paginates via cursor when returnAll is true and API returns next_cursor', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: [],
        campaign: '',
        blogger: '',
        search: '',
        publishedFrom: '',
        publishedTo: '',
        returnAll: true,
      };
      return map[name];
    });

    // Page 1: no filter qs, just cursor-less first call. Use a function matcher
    // so the lack of query string is also accepted (nock's `.query(true)` only
    // matches when a query is actually present).
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query((actual: Record<string, unknown>) => !('cursor' in actual))
      .reply(200, {
        success: true,
        data: [{ id: 'v1' }, { id: 'v2' }],
        meta: { next_cursor: 'CURSOR_PAGE_2' },
      });
    // Page 2: must carry the cursor from page 1.
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query({ cursor: 'CURSOR_PAGE_2' })
      .reply(200, {
        success: true,
        data: [{ id: 'v3' }],
        meta: { next_cursor: null },
      });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    // Paginator wraps aggregated items under { data: [...] }.
    expect(out[0][0].json.data).toEqual([{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]);
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(2);
  });

  it('sends an empty query string when no filters are set', async () => {
    ctx.getNodeParameter = vi.fn((name: string) => {
      const map: Record<string, any> = {
        operation: 'getStats',
        platform: [],
        campaign: '',
        blogger: '',
        search: '',
        publishedFrom: '',
        publishedTo: '',
        returnAll: false,
      };
      return map[name];
    });

    // Function matcher: accept either no query string OR any (irrelevant) one —
    // this test is about the executor's qs payload, not the API matcher.
    nock(BASE_URL)
      .get('/v1/videos/stats')
      .query(() => true)
      .reply(200, { success: true, data: [{ id: 'all-1' }, { id: 'all-2' }] });

    const out = await executeInfluticsVideo.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data).toEqual([{ id: 'all-1' }, { id: 'all-2' }]);
    // Verify the actual qs the executor sent is empty (no filter leaks through).
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({});
  });
});
