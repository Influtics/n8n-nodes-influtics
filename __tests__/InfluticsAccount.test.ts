import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { executeInfluticsAccount } from '../nodes/InfluticsAccount/InfluticsAccount.node';

const BASE_URL = 'https://api.influtics.com';

// Path-only helper — both Account endpoints take no qs / no body, so the
// shape mirrors the Get Job helper in InfluticsBlogger.test.ts. Mirrors n8n's
// real `requestWithAuthentication`:
//   - 2xx → returns the parsed JSON body directly
//   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
// GenericFunctions.mapInfluticsError reads `rawError.response.body.error`.
function makeCtx(overrides: Record<string, any> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'InfluticsAccount', type: 'n8n-nodes-influtics.influticsAccount', typeVersion: 1 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => {
    const map: Record<string, any> = {
      operation: 'getUsage',
      ...overrides,
    };
    return map[name];
  });
  ctx.helpers = {
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
  return ctx;
}

describe('InfluticsAccount node — happy path', () => {
  beforeAll(() => {
    // Block real network so accidental unmocked calls fail loudly.
    nock.disableNetConnect();
  });

  beforeEach(() => {
    // Default ctx already set per-test via makeCtx(); nothing to share here.
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/account/usage with no qs and no body, returns the data envelope', async () => {
    // Backend (handleGetUsage in api-worker/src/index.js) reads no query
    // params and no body. The wire request MUST be a bare GET — the executor
    // must NOT send `?` / body. Verify both: URL match + callArgs shape.
    const ctx = makeCtx({ operation: 'getUsage' });

    nock(BASE_URL)
      .get('/v1/account/usage')
      .reply(200, {
        success: true,
        data: {
          usage_history: [
            { created_at: '2026-08-23', endpoint: '/v1/videos/stats', credits_used: 0 },
            { created_at: '2026-08-22', endpoint: '/v1/videos/track', credits_used: 1 },
          ],
          summary: {
            plan: 'pro',
            is_unlimited: false,
            videos: { limit: 1000, used: 200 },
            credits: { total: 1000, used: 312 },
          },
        },
        meta: { processing_time_ms: 42, request_id: 'req-usage-1' },
      });

    const out = await executeInfluticsAccount.call(ctx as any, [{ json: {} }]);

    expect(out[0][0].json.data.summary.plan).toBe('pro');
    expect(out[0][0].json.data.summary.videos.limit).toBe(1000);
    expect(out[0][0].json.data.summary.videos.used).toBe(200);
    expect(out[0][0].json.data.summary.credits.used).toBe(312);
    expect(out[0][0].json.data.usage_history).toHaveLength(2);
    expect(out[0][0].json.meta.request_id).toBe('req-usage-1');
    // Guard against silent drift where the URL is right but the helper starts
    // sending qs/body the backend ignores.
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
    expect(callArgs.body).toBeUndefined();
  });

  it('GETs /v1/account/limits with no qs and no body, returns the data envelope', async () => {
    // Backend (handleGetLimits in api-worker/src/index.js) reads no query
    // params and no body. When getRateLimit returns null, the server fills in
    // the documented defaults — mirror that here so the executor's surface
    // contract stays the same regardless of which path the server took.
    const ctx = makeCtx({ operation: 'getLimits' });

    nock(BASE_URL)
      .get('/v1/account/limits')
      .reply(200, {
        success: true,
        data: {
          rate_limits: {
            requests_per_minute: 60,
            requests_per_hour: 3600,
            requests_per_day: 86400,
            requests_per_month: 10000,
            burst_allowance: 120,
          },
        },
        meta: { processing_time_ms: 5, request_id: 'req-limits-1' },
      });

    const out = await executeInfluticsAccount.call(ctx as any, [{ json: {} }]);

    expect(out[0][0].json.data.rate_limits.requests_per_minute).toBe(60);
    expect(out[0][0].json.data.rate_limits.requests_per_hour).toBe(3600);
    expect(out[0][0].json.data.rate_limits.burst_allowance).toBe(120);
    expect(out[0][0].json.meta.request_id).toBe('req-limits-1');
    const callArgs = (ctx.helpers.requestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
    expect(callArgs.body).toBeUndefined();
  });
});

describe('InfluticsAccount node — backend error codes surface', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('surfaces a 401 UNAUTHORIZED on /v1/account/usage', async () => {
    // Bad API key. The wire-side contract is the same `success: false,
    // error: { code, message }` envelope as every other error path.
    const ctx = makeCtx({ operation: 'getUsage' });

    nock(BASE_URL)
      .get('/v1/account/usage')
      .reply(401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or revoked API key.',
        },
      });

    await expect(executeInfluticsAccount.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });

  it('surfaces a 401 UNAUTHORIZED on /v1/account/limits', async () => {
    // Bad API key on the Limits endpoint. Same wire envelope.
    const ctx = makeCtx({ operation: 'getLimits' });

    nock(BASE_URL)
      .get('/v1/account/limits')
      .reply(401, {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or revoked API key.',
        },
      });

    await expect(executeInfluticsAccount.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });

  it('surfaces a 429 RATE_LIMITED on /v1/account/usage', async () => {
    // The LimitsClient.getCreditsUsage path can throw RateLimitError when the
    // org is at its monthly cap; api-worker surfaces that as a 429. The
    // executor must propagate the code to the n8n UI via mapInfluticsError.
    const ctx = makeCtx({ operation: 'getUsage' });

    nock(BASE_URL)
      .get('/v1/account/usage')
      .reply(429, {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Credits limit exceeded (1050/1000 credits used this month)',
          retry_after: 86400,
        },
      });

    await expect(executeInfluticsAccount.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });

  it('surfaces a 429 RATE_LIMITED on /v1/account/limits', async () => {
    // Same rate-limit path can hit on /v1/account/limits — verify the
    // executor propagates the code on this endpoint too.
    const ctx = makeCtx({ operation: 'getLimits' });

    nock(BASE_URL)
      .get('/v1/account/limits')
      .reply(429, {
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Credits limit exceeded (1050/1000 credits used this month)',
          retry_after: 86400,
        },
      });

    await expect(executeInfluticsAccount.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });
});

describe('InfluticsAccount node — single-batch invariant', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('fires Get Usage exactly ONCE per workflow run regardless of input item count', async () => {
    // Get Usage is a single-batch op: one GET per workflow run regardless of
    // how many items the caller wired in. Mirrors the Track-videos and
    // Track-bloggers single-batch pattern.
    const ctx = makeCtx({ operation: 'getUsage' });
    ctx.helpers.requestWithAuthentication = vi.fn().mockResolvedValue({
      success: true,
      data: {
        usage_history: [],
        summary: {
          plan: 'free',
          is_unlimited: false,
          videos: { limit: 50, used: 0 },
          credits: { total: 100, used: 0 },
        },
      },
      meta: { request_id: 'req-once-usage' },
    }) as any;

    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsAccount.call(ctx as any, items);

    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(1);
    expect(out[0]).toEqual([
      {
        json: {
          success: true,
          data: {
            usage_history: [],
            summary: {
              plan: 'free',
              is_unlimited: false,
              videos: { limit: 50, used: 0 },
              credits: { total: 100, used: 0 },
            },
          },
          meta: { request_id: 'req-once-usage' },
        },
      },
    ]);
  });

  it('fires Get Limits exactly ONCE per workflow run regardless of input item count', async () => {
    // Same single-batch invariant on the Limits endpoint — guards against
    // silent drift that would loop over input items.
    const ctx = makeCtx({ operation: 'getLimits' });
    ctx.helpers.requestWithAuthentication = vi.fn().mockResolvedValue({
      success: true,
      data: {
        rate_limits: {
          requests_per_minute: 60,
          requests_per_hour: 3600,
          requests_per_day: 86400,
          requests_per_month: 10000,
          burst_allowance: 120,
        },
      },
      meta: { request_id: 'req-once-limits' },
    }) as any;

    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsAccount.call(ctx as any, items);

    expect((ctx.helpers.requestWithAuthentication as any).mock.calls.length).toBe(1);
    expect(out[0]).toEqual([
      {
        json: {
          success: true,
          data: {
            rate_limits: {
              requests_per_minute: 60,
              requests_per_hour: 3600,
              requests_per_day: 86400,
              requests_per_month: 10000,
              burst_allowance: 120,
            },
          },
          meta: { request_id: 'req-once-limits' },
        },
      },
    ]);
  });
});
