import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeInfluticsTrend } from '../nodes/InfluticsTrend/InfluticsTrend.node';

const BASE_URL = 'https://api.influtics.com';

// GET /v1/trends/search is query-string-only; mirrors the Get Stats helper
// shape from InfluticsVideo.test.ts: serializes `qs` onto the URL so nock's
// `.query(...)` matcher sees the same path the production http helper would
// hit (request lib appends qs to URL).
function makeSearchCtx(overrides: Record<string, any> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'InfluticsTrend', type: 'n8n-nodes-influtics.influticsTrend', typeVersion: 1 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => {
    const map: Record<string, any> = {
      operation: 'search',
      keyword: 'fidget toys',
      platform: 'tiktok',
      additionalFields: {
        cursor: '',
        region: '',
        days: '',
      },
      ...overrides,
    };
    return map[name];
  });
  ctx.helpers = {
    requestWithAuthentication: vi.fn(async (_name, opts) => {
      let url = (opts as any).uri ?? (opts as any).url;
      const qs = (opts as any).qs;
      if (qs && typeof qs === 'object') {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(qs)) {
          if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
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
  return ctx;
}

describe('InfluticsTrend node — Search operation: happy path', () => {
  beforeAll(() => {
    // Block real network so accidental unmocked calls fail loudly.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    // Default ctx already set per-test via makeSearchCtx(); nothing to share here.
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/trends/search with just keyword + platform and returns the data envelope', async () => {
    // Backend (handleTrendsSearch in api-worker) requires `keyword` and
    // `platform`. cursor/region/days are optional. With all optional fields
    // empty, the executor must NOT put `cursor=`/`region=`/`days=` on the
    // wire — strip them so the request stays minimal.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(200, {
        success: true,
        data: [
          { keyword: 'fidget toys', volume: 1200000, post_count: 5000 },
          { keyword: 'fidget toys 2', volume: 200000, post_count: 1500 },
        ],
        meta: {
          request_id: 'req-1',
          processing_time_ms: 142,
          credits_used: 1,
        },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
    expect(out[0][0].json.data[1].volume).toBe(200000);
    expect(out[0][0].json.meta.credits_used).toBe(1);
    // Verify the executor's qs payload too — guards against silent drift where
    // the URL is right but the helper stops spreading it.
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({ keyword: 'fidget toys', platform: 'tiktok' });
  });

  it('returns the raw envelope (data + meta + next_cursor) without unwrapping', async () => {
    // Mirror Track-videos pattern: the executor returns the raw envelope so
    // downstream n8n consumers see exactly what the API sent. The meta block
    // may carry `next_cursor` for cursor-paginated responses.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1200000 }],
        meta: {
          request_id: 'req-2',
          processing_time_ms: 100,
          credits_used: 1,
          next_cursor: 'cur-abc',
        },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.meta.next_cursor).toBe('cur-abc');
  });
});

describe('InfluticsTrend node — Search operation: all optional params', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('forwards cursor + region + days when the caller provides them', async () => {
    // Backend (handleTrendsSearch) accepts cursor (returned by prior call),
    // region (ISO 3166-1 alpha-2), and days (one of 0|1|7|30|90|180). The
    // executor MUST forward all three when populated.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: 'cur-123', region: 'US', days: '7' },
    });

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({
        keyword: 'fidget toys',
        platform: 'tiktok',
        cursor: 'cur-123',
        region: 'US',
        days: '7',
      })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1200000 }],
        meta: { request_id: 'req-3', credits_used: 1 },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({
      keyword: 'fidget toys',
      platform: 'tiktok',
      cursor: 'cur-123',
      region: 'US',
      days: '7',
    });
  });

  it('accepts the no-window days value (0) as a valid forward', async () => {
    // Backend's VALID_DAYS = [0, 1, 7, 30, 90, 180]. `0` is the "no time
    // window" sentinel and must be forwarded, not stripped. Only empty
    // string is the "user didn't pick one" sentinel.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: 'DE', days: '0' },
    });

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok', region: 'DE', days: '0' })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1 }],
        meta: { request_id: 'req-4', credits_used: 1 },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs.days).toBe('0');
  });

  it('works on youtube just as well as tiktok (only two valid platforms)', async () => {
    // Backend rejects any platform not in {tiktok, youtube} with 400
    // VALIDATION_ERROR. The executor MUST accept youtube as the second
    // valid choice (the UI exposes both).
    const ctx = makeSearchCtx({ platform: 'youtube' });

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'youtube' })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 500000 }],
        meta: { request_id: 'req-5', credits_used: 1 },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
  });
});

describe('InfluticsTrend node — Search operation: defensive guards (no API call)', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('rejects empty keyword with a NodeOperationError WITHOUT hitting the API', async () => {
    // Backend rejects missing/empty keyword with 400 VALIDATION_ERROR.
    // Fail fast with a clear UI message instead of letting the workflow
    // silently 400.
    const ctx = makeSearchCtx({ keyword: '' });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Keyword is required/,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects whitespace-only keyword with a NodeOperationError WITHOUT hitting the API', async () => {
    // Backend trims then checks emptiness; a single space is "missing".
    // Mirror that defensively so the user gets a clear UI message rather
    // than a 400 VALIDATION_ERROR from the backend.
    const ctx = makeSearchCtx({ keyword: '   ' });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects empty platform with a NodeOperationError WITHOUT hitting the API', async () => {
    // Backend rejects missing/empty platform with 400 VALIDATION_ERROR.
    const ctx = makeSearchCtx({ platform: '' });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Platform is required/,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects invalid platform (not in {tiktok, youtube}) WITHOUT hitting the API', async () => {
    // The UI only exposes TikTok / YouTube, but defensive guard at the
    // executor level catches custom callers / schema drift.
    const ctx = makeSearchCtx({ platform: 'instagram' });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Platform must be one of: tiktok, youtube/,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects region that is not a two-letter ISO 3166-1 code WITHOUT hitting the API', async () => {
    // Backend validates region with `/^[A-Za-z]{2}$/`. Anything else gets
    // a 400 VALIDATION_ERROR. Defensive guard at the executor level
    // surfaces a clear UI message immediately.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: 'USA', days: '' },
    });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Region must be a two-letter ISO 3166-1 code/,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects region that is a single letter WITHOUT hitting the API', async () => {
    // Same regex guard catches single-letter values.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: 'U', days: '' },
    });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects days value not in the backend allow-list WITHOUT hitting the API', async () => {
    // Backend VALID_DAYS = [0, 1, 7, 30, 90, 180]. The UI clamps via
    // options; this is defense-in-depth against custom callers / schema drift.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: '', days: '14' },
    });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Days must be one of/,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects non-numeric days value WITHOUT hitting the API', async () => {
    // Defense-in-depth: even if the UI's options field is bypassed, the
    // executor's allow-list check rejects anything not in the 6-value set.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: '', days: 'forever' },
    });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(0);
  });
});

describe('InfluticsTrend node — Search operation: empty optional fields stripped from qs', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('omits cursor/region/days from the wire when all are blank', async () => {
    // Belt-and-braces against accidental drift: explicit empty-string
    // optional fields must NOT show up as `?cursor=&region=&days=` on the
    // wire. Strip them at the executor, so the request goes out minimal.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: '', days: '' },
    });

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query((actual: Record<string, unknown>) => {
        // Only keyword + platform on the wire.
        if (actual.keyword !== 'fidget toys') return false;
        if (actual.platform !== 'tiktok') return false;
        if (actual.cursor !== undefined) return false;
        if (actual.region !== undefined) return false;
        if (actual.days !== undefined) return false;
        return true;
      })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1 }],
        meta: { request_id: 'req-strip', credits_used: 1 },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(Object.keys(callArgs.qs)).toEqual(['keyword', 'platform']);
  });

  it('forwards only the populated optional fields', async () => {
    // Caller set only `region`. cursor and days must NOT appear on the wire
    // even though they exist as keys in additionalFields.
    const ctx = makeSearchCtx({
      additionalFields: { cursor: '', region: 'JP', days: '' },
    });

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query((actual: Record<string, unknown>) => {
        if (actual.keyword !== 'fidget toys') return false;
        if (actual.platform !== 'tiktok') return false;
        if (actual.region !== 'JP') return false;
        if (actual.cursor !== undefined) return false;
        if (actual.days !== undefined) return false;
        return true;
      })
      .reply(200, {
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1 }],
        meta: { request_id: 'req-partial', credits_used: 1 },
      });

    const out = await executeInfluticsTrend.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data[0].keyword).toBe('fidget toys');
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toEqual({
      keyword: 'fidget toys',
      platform: 'tiktok',
      region: 'JP',
    });
  });
});

describe('InfluticsTrend node — Search operation: backend error codes surface', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('surfaces a 402 PAID_PLAN_REQUIRED error to the caller', async () => {
    // Free-tier callers get 402 PAID_PLAN_REQUIRED with upgrade_url.
    // GenericFunctions.mapInfluticsError surfaces this via the description
    // channel so it appears in the n8n UI without code-fishing.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(402, {
        success: false,
        error: {
          code: 'PAID_PLAN_REQUIRED',
          message: 'This endpoint requires a paid plan.',
          upgrade_url: 'https://influtics.com/plans',
        },
      });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /PAID_PLAN_REQUIRED/,
    );
  });

  it('surfaces a 400 VALIDATION_ERROR response to the caller', async () => {
    // If the executor's defensive guards somehow miss an invalid input,
    // the backend will 400 with VALIDATION_ERROR. MapInfluticsError must
    // surface the code in the thrown error message.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(400, {
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid region. Must be a two-letter ISO 3166-1 country code.',
        },
      });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /VALIDATION_ERROR/,
    );
  });

  it('surfaces a 429 RATE_LIMITED response to the caller', async () => {
    // The credits check (LimitsClient.getCreditsUsage) returns a
    // RateLimitError with retry_after when used >= limit. MapInfluticsError
    // surfaces the code in the thrown error message.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(429, {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Credits limit exceeded (1050/1000 credits used this month)',
          retry_after: 86400,
        },
      });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });

  it('surfaces a 401 UNAUTHORIZED response to the caller', async () => {
    // Bad API key. The wire-side contract is the same `success: false,
    // error: { code, message }` envelope as every other error path.
    const ctx = makeSearchCtx();

    nock(BASE_URL)
      .get('/v1/trends/search')
      .query({ keyword: 'fidget toys', platform: 'tiktok' })
      .reply(401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or revoked API key.',
        },
      });

    await expect(executeInfluticsTrend.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });
});

describe('InfluticsTrend node — Search operation: single-batch invariant', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('fires the Search API exactly ONCE per workflow run regardless of input item count', async () => {
    // Search is a single-batch op: one GET per workflow run regardless of
    // how many items the caller wired in. Mirrors the Track-videos and
    // Track-bloggers pattern.
    const ctx = makeSearchCtx();
    ctx.helpers.requestWithAuthentication = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ keyword: 'fidget toys', volume: 1 }],
        meta: { credits_used: 1 },
      }) as any;

    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsTrend.call(ctx as any, items);

    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(1);
    expect(out[0]).toEqual([
      {
        json: {
          success: true,
          data: [{ keyword: 'fidget toys', volume: 1 }],
          meta: { credits_used: 1 },
        },
      },
    ]);
  });
});