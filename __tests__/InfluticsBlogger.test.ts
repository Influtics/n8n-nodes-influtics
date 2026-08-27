import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import { executeInfluticsBlogger } from '../nodes/InfluticsBlogger/InfluticsBlogger.node';

const BASE_URL = 'https://api.influtics.com';

// Track request body contract (see api-worker/src/handlers/lib/trackAccountValidator.js):
//   { platform, username, initial_videos_count }   — FLAT, no `channel` wrapper.
// `initial_videos_count` is REQUIRED (integer in [1, 500]). The plan and the
// stale `track.md` docs page omit it; the validator rejects bodies without it.
function makeTrackCtx(overrides: Record<string, any> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'InfluticsBlogger', type: 'n8n-nodes-influtics.influticsBlogger', typeVersion: 1 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => {
    const map: Record<string, any> = {
      operation: 'track',
      platform: 'tiktok',
      username: 'alice',
      initialVideosCount: 10,
      ...overrides,
    };
    return map[name];
  });
  ctx.helpers = {
    // Mirror n8n's real `httpRequestWithAuthentication` with `json: true`:
    //   - 2xx → returns the parsed JSON body directly
    //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
    // GenericFunctions.mapInfluticsError reads `rawError.response.body.error`.
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

// Query-aware helper for endpoints that read qs (`byUsername`). Same shape as
// the Get Stats describe block in InfluticsVideo.test.ts.
function makeQueryCtx(overrides: Record<string, any> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'InfluticsBlogger', type: 'n8n-nodes-influtics.influticsBlogger', typeVersion: 1 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => {
    const map: Record<string, any> = {
      ...overrides,
    };
    return map[name];
  });
  ctx.helpers = {
    httpRequestWithAuthentication: vi.fn(async (_name, opts) => {
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

// Path-only helper for endpoints that do NOT read qs (getJob). Same shape as
// the Track / Get By ID describe blocks in InfluticsVideo.test.ts.
function makePathCtx(overrides: Record<string, any> = {}) {
  const ctx = mockDeep<IExecuteFunctions>();
  ctx.getNode = vi
    .fn()
    .mockReturnValue({ name: 'InfluticsBlogger', type: 'n8n-nodes-influtics.influticsBlogger', typeVersion: 1 } as any);
  ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
  ctx.getInputData = vi.fn().mockReturnValue([{ json: {} }]);
  ctx.getNodeParameter = vi.fn((name: string) => {
    const map: Record<string, any> = { ...overrides };
    return map[name];
  });
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

describe('InfluticsBlogger node — Track operation', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  beforeEach(() => {
    // Default ctx already set per-test via makeTrackCtx(); nothing to share here.
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('POSTs the flat {platform, username, initial_videos_count} body to /v1/bloggers/track', async () => {
    const ctx = makeTrackCtx({
      operation: 'track',
      platform: 'tiktok',
      username: 'alice',
      initialVideosCount: 10,
    });

    nock(BASE_URL)
      .post('/v1/bloggers/track', {
        platform: 'tiktok',
        username: 'alice',
        initial_videos_count: 10,
      })
      .reply(202, {
        success: true,
        data: {
          job_id: 'job-abc-123',
          status: 'queued',
          status_url: '/v1/bloggers/jobs/job-abc-123',
          platform: 'tiktok',
          username: 'alice',
          estimated_duration_seconds: 30,
          polling: { retry_after_seconds: 1 },
        },
        meta: { request_id: 'req-1' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.job_id).toBe('job-abc-123');
    expect(out[0][0].json.data.status).toBe('queued');
  });

  it('rejects empty username with a NodeOperationError WITHOUT hitting the API', async () => {
    // The backend's trackAccountValidator rejects empty username (422). Fail
    // fast with a clear UI message instead of letting the workflow silently 422.
    const ctx = makeTrackCtx({ username: '' });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Username is required/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('rejects missing initialVideosCount with a NodeOperationError WITHOUT hitting the API', async () => {
    // Backend (validateTrackBloggerBody) requires initial_videos_count to be an
    // integer in [1, 500]. A blank UI value must not reach the wire as
    // `initial_videos_count: 0` or `NaN`.
    const ctx = makeTrackCtx({ initialVideosCount: '' as any });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /initial_videos_count/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('clamps initial_videos_count to the backend hard cap of 500 when caller passes 9999', async () => {
    // Backend rejects initial_videos_count > 500 with 422. The UI clamps via
    // `typeOptions.maxValue = 500`, but defense-in-depth at the executor means
    // a custom caller or schema drift cannot bypass the cap.
    const ctx = makeTrackCtx({ initialVideosCount: 9999 });

    nock(BASE_URL)
      .post('/v1/bloggers/track', {
        platform: 'tiktok',
        username: 'alice',
        initial_videos_count: 500,
      })
      .reply(202, {
        success: true,
        data: { job_id: 'job-clamp', status: 'queued', status_url: '/v1/bloggers/jobs/job-clamp' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.body).toEqual({
      platform: 'tiktok',
      username: 'alice',
      initial_videos_count: 500,
    });
    expect(out[0][0].json.data.job_id).toBe('job-clamp');
  });

  it('fires the Track API exactly ONCE per workflow run regardless of input item count', async () => {
    // Track is a single-batch op: one POST per workflow run regardless of how
    // many items the caller wired in. Mirrors the Track-videos pattern.
    const ctx = makeTrackCtx();
    ctx.helpers.httpRequestWithAuthentication = vi
      .fn()
      .mockResolvedValue({ success: true, data: { job_id: 'job-once', status: 'queued' } }) as any;

    const items = [{ json: {} }, { json: {} }, { json: {} }];
    const out = await executeInfluticsBlogger.call(ctx as any, items);

    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(1);
    expect(out[0]).toEqual([
      { json: { success: true, data: { job_id: 'job-once', status: 'queued' } } },
    ]);
  });

  it('surfaces a 402 PAID_PLAN_REQUIRED error to the caller', async () => {
    // Free-tier orgs cannot POST /v1/bloggers/track — backend returns 402 with
    // upgrade_url. GenericFunctions.mapInfluticsError surfaces this via the
    // description channel.
    const ctx = makeTrackCtx();

    nock(BASE_URL)
      .post('/v1/bloggers/track')
      .reply(402, {
        success: false,
        error: {
          code: 'PAID_PLAN_REQUIRED',
          message: 'This endpoint requires a paid plan.',
          upgrade_url: 'https://influtics.com/plans',
        },
      });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /PAID_PLAN_REQUIRED/,
    );
  });

  it('surfaces a 409 CREATOR_ALREADY_TRACKED error to the caller', async () => {
    const ctx = makeTrackCtx();

    nock(BASE_URL)
      .post('/v1/bloggers/track')
      .reply(409, {
        success: false,
        error: {
          code: 'CREATOR_ALREADY_TRACKED',
          message: 'Creator alice on tiktok is already being tracked.',
          tracked_account_id: 'tracked-1',
        },
      });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /CREATOR_ALREADY_TRACKED/,
    );
  });
});

describe('InfluticsBlogger node — Get Job operation', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/bloggers/jobs/{job_id} and returns the parsed data envelope', async () => {
    // Backend shapeJob uses `status` (queued|processing|succeeded|error), not
    // `state`. The plan's reference test asserted `.state` — that was wrong.
    const ctx = makePathCtx({ operation: 'getJob', jobId: 'job-abc-123' });

    nock(BASE_URL)
      .get('/v1/bloggers/jobs/job-abc-123')
      .reply(200, {
        success: true,
        data: {
          job_id: 'job-abc-123',
          status: 'succeeded',
          platform: 'tiktok',
          username: 'alice',
          tracked_account_id: 'tracked-1',
          blogger_id: 'blogger-1',
          result: { tracked_account_id: 'tracked-1', blogger_id: 'blogger-1', is_active: true },
        },
        meta: { request_id: 'req-2' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.status).toBe('succeeded');
    expect(out[0][0].json.data.result.blogger_id).toBe('blogger-1');
    // Backend reads no qs on /v1/bloggers/jobs/{job_id} — guard against
    // accidental drift that would put `?platform=...` or similar on the wire.
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    expect(callArgs.qs).toBeUndefined();
  });

  it('rejects empty jobId with a NodeOperationError WITHOUT hitting the API', async () => {
    // Without an id we'd send GET /v1/bloggers/jobs/ which 404s with a
    // confusing URL and no actionable error.
    const ctx = makePathCtx({ operation: 'getJob', jobId: '' });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Job ID is required/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('URL-encodes the jobId so slashes / slashes-in-ids never break routing', async () => {
    // Defensive: encodeURIComponent guards against a jobId with reserved chars.
    const ctx = makePathCtx({ operation: 'getJob', jobId: 'job/with/slashes' });

    nock(BASE_URL)
      .get('/v1/bloggers/jobs/job%2Fwith%2Fslashes')
      .reply(200, { success: true, data: { status: 'queued' } });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.status).toBe('queued');
  });

  it('surfaces a 410 JOB_TIMEOUT response to the caller', async () => {
    // Sweeper-marked jobs surface as 410 JOB_TIMEOUT. Callers must re-POST
    // /v1/bloggers/track to retry.
    const ctx = makePathCtx({ operation: 'getJob', jobId: 'job-stuck' });

    nock(BASE_URL)
      .get('/v1/bloggers/jobs/job-stuck')
      .reply(410, {
        success: false,
        error: {
          code: 'JOB_TIMEOUT',
          message: 'Job job-stuck exceeded JOB_TIMEOUT (1h).',
        },
      });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /JOB_TIMEOUT/,
    );
  });

  it('surfaces a 404 NOT_FOUND response (cross-org or genuinely missing)', async () => {
    // Both "doesn't exist" and "belongs to another org" collapse to 404
    // (Stripe-parity, existence-leak protection).
    const ctx = makePathCtx({ operation: 'getJob', jobId: 'job-missing' });

    nock(BASE_URL)
      .get('/v1/bloggers/jobs/job-missing')
      .reply(404, {
        success: false,
        error: { code: 'NOT_FOUND', message: 'Job job-missing not found.' },
      });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});

describe('InfluticsBlogger node — By Username operation', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('GETs /v1/bloggers/by-username/{username} with platform=tiktok query string', async () => {
    // The legacy /v1/bloggers/info?username=... form was REMOVED 2026-08-20
    // (see api-worker CLAUDE.md "Deprecations"). The canonical path is
    // /v1/bloggers/by-username/{username}?platform={platform}, with `platform`
    // defaulting to `tiktok` server-side if omitted.
    const ctx = makeQueryCtx({
      operation: 'byUsername',
      username: 'alice',
      platform: 'tiktok',
    });

    nock(BASE_URL)
      .get('/v1/bloggers/by-username/alice')
      .query({ platform: 'tiktok' })
      .reply(200, {
        success: true,
        data: {
          blogger: {
            id: 'blogger-1',
            channel_username: 'alice',
            platform: 'tiktok',
            number_of_subscribers: 38800,
            is_tracked: true,
            video_count: 4,
          },
        },
        meta: { processing_time_ms: 50, request_id: 'req-3' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.blogger.channel_username).toBe('alice');
    expect(out[0][0].json.data.blogger.number_of_subscribers).toBe(38800);
  });

  it('omits the platform query string when the user leaves it blank (backend defaults to tiktok)', async () => {
    // Backend reads `url.searchParams.get('platform') || 'tiktok'`, so an empty
    // UI value lands on the same server default. Sending `?platform=` (empty
    // value) would NOT do the same — Supabase-style explicit-empty would
    // sometimes propagate as "" instead of the default. Strip empty qs.
    const ctx = makeQueryCtx({
      operation: 'byUsername',
      username: 'alice',
      platform: '',
    });

    nock(BASE_URL)
      .get('/v1/bloggers/by-username/alice')
      .reply(200, {
        success: true,
        data: { blogger: { channel_username: 'alice' } },
        meta: { request_id: 'req-4' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.blogger.channel_username).toBe('alice');
    const callArgs = (ctx.helpers.httpRequestWithAuthentication as any).mock.calls[0][1];
    // Executor must NOT forward an empty `platform` string — let the backend
    // apply its own `tiktok` default.
    expect(callArgs.qs).toBeUndefined();
  });

  it('URL-encodes the username so `@handle` works (defensive: UI usually strips @)', async () => {
    // The backend decodes the path segment with decodeURIComponent, so a
    // percent-encoded `@` (%40) is restored to `@`. The executor MUST
    // encodeURIComponent the path segment — otherwise `@` would land as a
    // raw literal in the URL and confuse logs / cache keys.
    const ctx = makeQueryCtx({
      operation: 'byUsername',
      username: '@alice',
      platform: 'tiktok',
    });

    nock(BASE_URL)
      .get('/v1/bloggers/by-username/%40alice')
      .query({ platform: 'tiktok' })
      .reply(200, {
        success: true,
        data: { blogger: { channel_username: '@alice', platform: 'tiktok' } },
        meta: { request_id: 'req-5' },
      });

    const out = await executeInfluticsBlogger.call(ctx as any, [{ json: {} }]);
    expect(out[0][0].json.data.blogger.channel_username).toBe('@alice');
  });

  it('rejects empty username with a NodeOperationError WITHOUT hitting the API', async () => {
    // Without a username the URL would be /v1/bloggers/by-username/ — backend
    // returns 400 VALIDATION_ERROR. Fail fast with a clear UI message instead.
    const ctx = makeQueryCtx({
      operation: 'byUsername',
      username: '',
      platform: 'tiktok',
    });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      NodeOperationError,
    );
    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /Username is required/,
    );
    expect((ctx.helpers.httpRequestWithAuthentication as any).mock.calls.length).toBe(0);
  });

  it('surfaces a 404 BLOGGER_NOT_TRACKED response to the caller', async () => {
    // The endpoint is read-only — backend NEVER auto-tracks. If the creator
    // is not tracked by the calling org, it returns 404 BLOGGER_NOT_TRACKED
    // and points the caller at POST /v1/bloggers/track.
    const ctx = makeQueryCtx({
      operation: 'byUsername',
      username: 'unknown',
      platform: 'tiktok',
    });

    nock(BASE_URL)
      .get('/v1/bloggers/by-username/unknown')
      .query({ platform: 'tiktok' })
      .reply(404, {
        success: false,
        error: {
          code: 'BLOGGER_NOT_TRACKED',
          message:
            'Blogger unknown is not tracked by your organization. Use POST /v1/bloggers/track to start tracking.',
        },
      });

    await expect(executeInfluticsBlogger.call(ctx as any, [{ json: {} }])).rejects.toThrow(
      /BLOGGER_NOT_TRACKED/,
    );
  });
});
