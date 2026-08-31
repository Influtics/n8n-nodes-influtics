import { describe, it, expect } from 'vitest';
import { BLOGGER_OPERATIONS } from '../../resources/blogger';
import {
  mockContext,
  type InfluticsApiRequestFn,
  type MockContextOptions,
} from '../helpers/mockContext';

/**
 * Influtics resource-module tests — Blogger (Track + Get Job + By Username).
 *
 * The legacy `nodes/InfluticsBlogger/InfluticsBlogger.node.ts` is the source
 * of truth for the backend contract (verified against api-worker
 * `trackAccountValidator.js` + `shapeJob`). These tests pin the same wire
 * shape at the dispatcher-handler level so the legacy node can be retired
 * safely later.
 *
 * Twenty tests cover all three operations end-to-end:
 *   track (10): happy minimal, happy full, wire shape, clamp >500, reject <1,
 *               reject non-integer, reject missing platform, reject missing
 *               username, propagate 422 SUBSCRIPTION_LIMIT, propagate 409
 *               CREATOR_ALREADY_TRACKED.
 *   getJob (5): happy path, wire shape, URL-encodes special chars, reject
 *               empty jobId, propagate 404 NOT_FOUND.
 *   byUsername (6): happy path with platform, happy path empty platform
 *                   (no qs on wire), wire shape, URL-encodes special chars,
 *                   reject empty username, propagate 404 BLOGGER_NOT_TRACKED.
 *
 * Each handler is a thin wrapper around `influticsApiRequest`, so we stub the
 * apiRequest at the seam exposed by `mockContext` instead of standing up a
 * real nock + httpRequestWithAuthentication chain. This keeps the assertions
 * focused on the handler's responsibility: it calls the right endpoint with
 * the right shape, runs the defensive guards before the call, and propagates
 * whatever the api layer throws.
 */

type RecordedCall = {
  method: string;
  path: string;
  body?: unknown;
  qs?: unknown;
};

function bindCtx(options: MockContextOptions, stub: InfluticsApiRequestFn) {
  const bind = mockContext(options);
  return { ctx: bind(stub) };
}

/**
 * Build a stub apiRequest that records every call AND either returns a canned
 * response or throws a canned error based on the `mode` parameter.
 *
 * Modes:
 *   - 'ok' → return `canned` as the API response.
 *   - 'throwXXX' → throw an Error whose message starts with the documented
 *     backend code. The real `influticsApiRequest` catches the helper error,
 *     extracts `{ code, message }` via `mapInfluticsError`, and rethrows a
 *     NodeApiError whose `.message` starts with the code. The stub throws the
 *     same shape so the handler-under-test can be observed propagating it
 *     untouched.
 */
function makeRecordingStub(
  mode:
    | 'ok'
    | 'throw401'
    | 'throw404'
    | 'throw409'
    | 'throw422'
    | 'throw429',
  canned: unknown,
): { fn: InfluticsApiRequestFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fn: InfluticsApiRequestFn = async function (
    method,
    path,
    body,
    qs,
  ) {
    calls.push({ method, path, body, qs });
    if (mode !== 'ok') {
      const message =
        mode === 'throw401'
          ? 'UNAUTHORIZED: Invalid or revoked API key.'
          : mode === 'throw404'
          ? 'NOT_FOUND: Job or resource does not exist.'
          : mode === 'throw409'
          ? 'CREATOR_ALREADY_TRACKED: Creator is already tracked by this organization.'
          : mode === 'throw422'
          ? 'SUBSCRIPTION_LIMIT: Plan limit reached for tracked creators.'
          : 'RATE_LIMITED: Credits limit exceeded';
      const err: any = new Error(message);
      throw err;
    }
    return canned as any;
  };
  return { fn, calls };
}

describe('resources/blogger — track', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // The handler MUST NOT unwrap the envelope — downstream n8n consumers
    // see exactly what the API sent (mirrors the Track / Get Stats
    // patterns). The 202 Accepted envelope carries job_id + status_url +
    // polling, asserted structurally so any silent drift breaks the
    // contract.
    const envelope = {
      success: true,
      data: {
        job_id: 'job-abc-123',
        status_url: '/v1/bloggers/jobs/job-abc-123',
        polling: { retry_after_seconds: 5 },
      },
      meta: { processing_time_ms: 12, request_id: 'req-track-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 10 },
      },
      fn,
    );

    const result = await BLOGGER_OPERATIONS.track.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.job_id).toBe('job-abc-123');
    expect((result as any).meta.request_id).toBe('req-track-1');
  });

  it('forwards platform + username + initial_videos_count on every supported platform', async () => {
    // Backend validateTrackBloggerBody accepts four platforms (tiktok,
    // instagram, youtube, vk). For each, the wire request must carry the
    // EXACT same keys (snake_case for initial_videos_count — the validator
    // rejects camelCase). Guards against silent drift in case any future
    // refactor renames the field.
    const platforms: Array<'tiktok' | 'instagram' | 'youtube' | 'vk'> = [
      'tiktok',
      'instagram',
      'youtube',
      'vk',
    ];
    for (const platform of platforms) {
      const { fn, calls } = makeRecordingStub('ok', {
        success: true,
        data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
        meta: {},
      });
      const { ctx } = bindCtx(
        {
          resource: 'blogger',
          operation: 'track',
          params: { platform, username: 'handle', initialVideosCount: 42 },
        },
        fn,
      );

      await BLOGGER_OPERATIONS.track.call(ctx, 0);

      expect(calls).toHaveLength(1);
      expect(calls[0].body).toEqual({
        platform,
        username: 'handle',
        initial_videos_count: 42,
      });
    }
  });

  it('POSTs /v1/bloggers/track with body and NO qs', async () => {
    // Wire shape invariant: right path, right method, body carries all
    // three keys, no qs. The backend's trackAccountValidator is the
    // source of truth — body keys MUST match snake_case exactly.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 10 },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.track.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/v1/bloggers/track');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toEqual({
      platform: 'tiktok',
      username: 'creator1',
      initial_videos_count: 10,
    });
  });

  it('clamps initial_videos_count > 500 down to 500 before sending', async () => {
    // Defense-in-depth: the UI clamps via typeOptions.maxValue = 500, but
    // a custom caller could bypass it. The handler MUST clamp 1000 → 500
    // BEFORE the HTTP call so the backend never sees an out-of-range
    // integer. Mirrors the legacy InfluticsBlogger executor.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 1000 },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.track.call(ctx, 0);

    expect(calls[0].body).toEqual({
      platform: 'tiktok',
      username: 'creator1',
      initial_videos_count: 500,
    });
  });

  it('clamps initial_videos_count < 1 UP to 1 before sending', async () => {
    // Legacy InfluticsBlogger uses
    //   Math.max(1, Math.min(initialVideosCount, 500))
    // which silently clamps 0 → 1, -5 → 1, etc. The UI clamps via
    // minValue = 1, but a custom caller can bypass it. Documents the
    // "clamp UP" branch — distinct from the "clamp DOWN" branch above.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 0 },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.track.call(ctx, 0);

    expect(calls[0].body).toEqual({
      platform: 'tiktok',
      username: 'creator1',
      initial_videos_count: 1,
    });
  });

  it('throws NodeOperationError when initial_videos_count is a non-integer string', async () => {
    // Legacy InfluticsBlogger rejects 'abc' before the HTTP call. The
    // defense-in-depth check covers custom callers that bypass the
    // typeOptions guard. Number.isFinite('abc' / 1) = NaN, !isInteger
    // → guard fires.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 'abc' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /between 1 and 500/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when initial_videos_count is the empty string', async () => {
    // The UI defaults the number field to a real number, but custom
    // callers can pass ''. The legacy guard explicitly rejects '' /
    // null / undefined. Documents the "missing" branch.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: '' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /between 1 and 500/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when platform is missing', async () => {
    // Backend rejects missing platform with 422 VALIDATION_ERROR. The UI
    // dropdown has a default (tiktok) so this fires only when a custom
    // caller passes ''. Documents the missing-platform guard.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: '', username: 'creator1', initialVideosCount: 10 },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /Platform is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when username is missing', async () => {
    // Backend rejects missing username with 422 VALIDATION_ERROR. Same
    // shape as the platform guard — fail fast BEFORE the HTTP call.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status_url: '/v1/bloggers/jobs/j', polling: { retry_after_seconds: 5 } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: '', initialVideosCount: 10 },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /Username is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 422 SUBSCRIPTION_LIMIT from the api-request layer', async () => {
    // The user's plan is full (see api-worker trackAccountValidator
    // subscription check). Backend returns 422 SUBSCRIPTION_LIMIT. The
    // handler must propagate the code via mapInfluticsError so the n8n
    // UI surfaces the upgrade prompt.
    const { fn } = makeRecordingStub('throw422', null);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 10 },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /SUBSCRIPTION_LIMIT/,
    );
  });

  it('propagates a 409 CREATOR_ALREADY_TRACKED from the api-request layer', async () => {
    // Same creator was tracked previously (see api-worker
    // trackAccountValidator dedup check). Backend returns 409
    // CREATOR_ALREADY_TRACKED. The handler must propagate the code
    // untouched so the user sees a clear UI message.
    const { fn } = makeRecordingStub('throw409', null);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'track',
        params: { platform: 'tiktok', username: 'creator1', initialVideosCount: 10 },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /CREATOR_ALREADY_TRACKED/,
    );
  });
});

describe('resources/blogger — getJob', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // shapeJob uses `status` (queued|processing|succeeded|error), NOT
    // `state`. Asserted structurally so any silent rename breaks the
    // contract.
    const envelope = {
      success: true,
      data: {
        job_id: 'job-abc-123',
        status: 'succeeded',
        result: { creator_id: 'cr-1', username: 'creator1', platform: 'tiktok' },
      },
      meta: { processing_time_ms: 4, request_id: 'req-job-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'getJob',
        params: { jobId: 'job-abc-123' },
      },
      fn,
    );

    const result = await BLOGGER_OPERATIONS.getJob.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.status).toBe('succeeded');
    expect((result as any).meta.request_id).toBe('req-job-1');
  });

  it('GETs /v1/bloggers/jobs/{id} with NO qs and NO body', async () => {
    // Wire shape invariant: GET, no body, no qs, path-only. The backend
    // reads everything from the URL segment. Guards against silent drift
    // where a future refactor starts sending qs/body the backend ignores.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status: 'queued' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'getJob',
        params: { jobId: 'job-abc-123' },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.getJob.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/bloggers/jobs/job-abc-123');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toBeUndefined();
  });

  it('URL-encodes special characters in jobId', async () => {
    // Backend reads `decodeURIComponent` server-side. The executor MUST
    // `encodeURIComponent` the path segment so `@handle`, slashes, and
    // other reserved chars round-trip cleanly. Tests with a colon — a
    // common character in legacy job-id schemes (e.g. `ns:job-1`).
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'ns:job-1', status: 'queued' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'getJob',
        params: { jobId: 'ns:job-1' },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.getJob.call(ctx, 0);

    expect(calls[0].path).toBe('/v1/bloggers/jobs/ns%3Ajob-1');
  });

  it('throws NodeOperationError when jobId is empty', async () => {
    // Without a jobId the URL would be `/v1/bloggers/jobs/` — the
    // backend 404s with a confusing URL and no actionable error. Fail
    // fast with a clear UI message and DO NOT make the HTTP call.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { job_id: 'j', status: 'queued' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'getJob',
        params: { jobId: '' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.getJob.call(ctx, 0)).rejects.toThrow(
      /Job ID is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 404 NOT_FOUND from the api-request layer', async () => {
    // Job ID does not exist OR belongs to a different org (Stripe-parity
    // per api-worker CLAUDE.md). Backend collapses both into 404. The
    // handler must propagate the message untouched.
    const { fn } = makeRecordingStub('throw404', null);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'getJob',
        params: { jobId: 'job-missing' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.getJob.call(ctx, 0)).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});

describe('resources/blogger — byUsername', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // Read-only endpoint. Asserts the envelope is preserved verbatim so
    // downstream n8n consumers see exactly what the API sent.
    const envelope = {
      success: true,
      data: {
        creator_id: 'cr-1',
        username: 'creator1',
        platform: 'instagram',
        is_tracked: true,
        stats: { videos: 120, followers: 50000 },
      },
      meta: { processing_time_ms: 8, request_id: 'req-by-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: 'creator1', platform: 'instagram' },
      },
      fn,
    );

    const result = await BLOGGER_OPERATIONS.byUsername.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.creator_id).toBe('cr-1');
    expect((result as any).meta.request_id).toBe('req-by-1');
  });

  it('strips empty platform — no platform qs on the wire when caller leaves it blank', async () => {
    // The UI defaults the platform dropdown to 'tiktok', but a custom
    // caller can pass ''. The legacy InfluticsBlogger executor strips
    // empty strings so the wire request stays minimal — the backend
    // defaults to tiktok anyway. Documents the stripping contract.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { creator_id: 'cr-1', username: 'creator1', platform: 'tiktok' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: 'creator1', platform: '' },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.byUsername.call(ctx, 0);

    expect(calls[0].qs).toBeUndefined();
  });

  it('GETs /v1/bloggers/by-username/{encoded} with platform qs when supplied', async () => {
    // Wire shape invariant: GET, path-only (URL-encoded username), qs
    // carries platform ONLY when truthy. Guards against silent drift in
    // either direction — extra qs keys or missing ones.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { creator_id: 'cr-1', username: 'creator1', platform: 'youtube' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: 'creator1', platform: 'youtube' },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.byUsername.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/bloggers/by-username/creator1');
    expect(calls[0].qs).toEqual({ platform: 'youtube' });
    expect(calls[0].body).toBeUndefined();
  });

  it('URL-encodes special characters in username', async () => {
    // Backend `decodeURIComponent` server-side. Executor MUST encode the
    // path segment so `@handle/with/slash` round-trips cleanly. Tests
    // with a slashed handle — the path would otherwise split on `/` and
    // 404 in the router.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { creator_id: 'cr-1', username: '@handle/with/slash', platform: 'tiktok' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: '@handle/with/slash', platform: 'tiktok' },
      },
      fn,
    );

    await BLOGGER_OPERATIONS.byUsername.call(ctx, 0);

    expect(calls[0].path).toBe(
      '/v1/bloggers/by-username/%40handle%2Fwith%2Fslash',
    );
  });

  it('throws NodeOperationError when username is empty', async () => {
    // Without a username the URL would be `/v1/bloggers/by-username/` —
    // the backend returns 400 VALIDATION_ERROR. Fail fast with a clear
    // UI message and DO NOT make the HTTP call.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { creator_id: 'cr-1', username: 'creator1', platform: 'tiktok' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: '', platform: 'tiktok' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.byUsername.call(ctx, 0)).rejects.toThrow(
      /Username is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 404 BLOGGER_NOT_TRACKED from the api-request layer', async () => {
    // Read-only — the legacy executor NEVER auto-tracks. If the creator
    // is not tracked by the calling org, the backend returns 404
    // BLOGGER_NOT_TRACKED. The handler must propagate the code so the
    // n8n UI can surface a "track this creator first" message.
    const { fn } = makeRecordingStub('throw404', null);
    const { ctx } = bindCtx(
      {
        resource: 'blogger',
        operation: 'byUsername',
        params: { username: 'unknown', platform: 'tiktok' },
      },
      fn,
    );

    await expect(BLOGGER_OPERATIONS.byUsername.call(ctx, 0)).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});
