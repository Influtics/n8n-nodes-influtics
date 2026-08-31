import { describe, it, expect } from 'vitest';
import { VIDEO_OPERATIONS } from '../../resources/video';
import {
  mockContext,
  type InfluticsApiRequestFn,
  type MockContextOptions,
} from '../helpers/mockContext';

/**
 * Influtics resource-module tests — Video (Track + Get Stats + Get By ID +
 * Get By External ID + Update By External ID).
 *
 * Backend contract verified against api-worker `handleTrackVideos` /
 * `handleGetVideoStats` / `handleGetVideoById` /
 * `handleGetVideoByExternalId` / `handlePatchVideoByExternalId`.
 *
 * Thirty-one tests cover all five operations end-to-end:
 *   track (4):            envelope passthrough; wire shape; reject empty urls;
 *                         propagate 429 RATE_LIMITED.
 *   getStats (10):        envelope passthrough; wire shape with 5 filters +
 *                         limit; omits empty filters; clamps limit > 100;
 *                         clamps limit < 1 to 50 default; returnAll paginates
 *                         until has_more=false; returnAll stops at
 *                         PAGINATION_MAX_PAGES=50 even with has_more=true;
 *                         returnAll tolerates missing `data.data` wrapper;
 *                         returnAll returns `{ data: [...] }` envelope;
 *                         propagates 401 UNAUTHORIZED.
 *   getById (5):          envelope passthrough; wire shape (GET
 *                         /v1/videos/by-id/{encoded}, no qs/body); URL-
 *                         encodes special chars (colon); reject empty id;
 *                         propagate 404 NOT_FOUND.
 *   getByExternalId (5):  envelope passthrough; wire shape (GET
 *                         /v1/videos/by-external-id/{encoded}, no qs/body);
 *                         URL-encodes special chars; reject empty
 *                         externalId; reject empty platform.
 *   updateByExternalId (8): envelope passthrough minimal; wire shape PATCH
 *                         /v1/videos/by-external-id/{encoded} with body
 *                         `{ notes }`; omits empty fields from body;
 *                         accepts all 4 fields together; reject empty
 *                         externalId; reject empty platform; reject empty
 *                         body (no updateFields); propagate 404 NOT_FOUND.
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
          ? 'NOT_FOUND: Video does not exist.'
          : 'RATE_LIMITED: Credits limit exceeded';
      const err: any = new Error(message);
      throw err;
    }
    return canned as any;
  };
  return { fn, calls };
}

/**
 * Sequenced stub: returns the next canned response from `canned[]` on each
 * successive invocation. Throws `throwMessage` on every call when a throw mode
 * is requested (matches the single-response makeRecordingStub contract for
 * propagation tests).
 *
 * Used by the getStats `returnAll: true` pagination tests where each page in
 * the walk returns a different `data.data` + `data.pagination` shape.
 */
function makeSequencedStub(
  canned: unknown[],
): { fn: InfluticsApiRequestFn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fn: InfluticsApiRequestFn = async function (
    method,
    path,
    body,
    qs,
  ) {
    calls.push({ method, path, body, qs });
    const idx = Math.min(i, canned.length - 1);
    i += 1;
    return canned[idx] as any;
  };
  return { fn, calls };
}

describe('resources/video — track', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // The handler MUST NOT unwrap the envelope — downstream n8n consumers
    // see exactly what the API sent. The 202 Accepted envelope carries
    // job_ids + per-URL status, asserted structurally so any silent drift
    // breaks the contract.
    const envelope = {
      success: true,
      data: {
        tracked: [
          { url: 'https://tiktok.com/@a/video/1', status: 'queued' },
          { url: 'https://tiktok.com/@b/video/2', status: 'queued' },
          { url: 'https://tiktok.com/@c/video/3', status: 'queued' },
        ],
      },
      meta: { processing_time_ms: 14, request_id: 'req-track-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'track',
        params: {
          urls: {
            urls: [
              'https://tiktok.com/@a/video/1',
              'https://tiktok.com/@b/video/2',
              'https://tiktok.com/@c/video/3',
            ],
          },
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.track.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.tracked).toHaveLength(3);
    expect((result as any).meta.request_id).toBe('req-track-1');
  });

  it('POSTs /v1/videos/track with body { urls } and NO qs', async () => {
    // Wire shape invariant: POST, body carries the array, no qs. The
    // backend's handleTrackVideos is the source of truth — body MUST
    // contain exactly one key (`urls`) whose value is the array.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { tracked: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'track',
        params: {
          urls: {
            urls: [
              'https://tiktok.com/@a/video/1',
              'https://tiktok.com/@b/video/2',
            ],
          },
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.track.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].path).toBe('/v1/videos/track');
    expect(calls[0].body).toEqual({
      urls: [
        'https://tiktok.com/@a/video/1',
        'https://tiktok.com/@b/video/2',
      ],
    });
    expect(calls[0].qs).toBeUndefined();
  });

  it('throws NodeOperationError when urls is empty', async () => {
    // Empty urls array → backend returns 400 VALIDATION_ERROR. Fail fast
    // with a clear UI message BEFORE the HTTP call so the user sees the
    // missing-input error rather than a confusing 400 envelope.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { tracked: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'track',
        params: { urls: { urls: [] } },
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /Provide at least one video URL/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when urls param is missing entirely', async () => {
    // Defensive: the n8n UI guarantees the `urls` collection is present,
    // but a custom caller can leave it off. The legacy guard explicitly
    // rejects undefined/null arrays too.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { tracked: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'track',
        params: {},
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /Provide at least one video URL/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 429 RATE_LIMITED from the api-request layer', async () => {
    // Plan-level credits exhausted → 429 RATE_LIMITED envelope from
    // handleTrackVideos. Handler must let mapInfluticsError's
    // `RATE_LIMITED:` message bubble untouched so the n8n UI surfaces the
    // code via NodeApiError.description.
    const { fn } = makeRecordingStub('throw429', null);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'track',
        params: {
          urls: { urls: ['https://tiktok.com/@a/video/1'] },
        },
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.track.call(ctx, 0)).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });
});

describe('resources/video — getStats', () => {
  it('returns the full server envelope (success/data/meta) untouched on minimal call', async () => {
    // Minimal call (returnAll: false, no filters) returns a single GET
    // response enveloped exactly as the backend sent it. Pinning the
    // shape here so any silent unwrap breaks the contract.
    const envelope = {
      success: true,
      data: {
        data: [
          { video_id: 'v-1', views: 1000, likes: 50 },
          { video_id: 'v-2', views: 2000, likes: 80 },
        ],
        pagination: { limit: 50, offset: 0, total: 2, has_more: false },
      },
      meta: { processing_time_ms: 7, request_id: 'req-stats-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: false,
          limit: 50,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.data).toHaveLength(2);
    expect((result as any).data.pagination.has_more).toBe(false);
  });

  it('GETs /v1/videos/stats with all 5 filters + limit on the wire', async () => {
    // Wire shape invariant: GET, no body, qs carries every truthy filter
    // AND a limit (because returnAll=false). Guards against silent drift
    // where any of the keys gets dropped between the param map and the
    // wire request.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { data: [], pagination: { limit: 25, offset: 0, total: 0, has_more: false } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: false,
          limit: 25,
          platform: 'tiktok',
          status: 'active',
          blogger_username: 'creator1',
          sort: 'views',
          order: 'desc',
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/videos/stats');
    expect(calls[0].body).toBeUndefined();
    expect(calls[0].qs).toEqual({
      limit: 25,
      platform: 'tiktok',
      status: 'active',
      blogger_username: 'creator1',
      sort: 'views',
      order: 'desc',
    });
  });

  it('omits empty filters from qs — "" is NOT sent on the wire', async () => {
    // The n8n UI collection field defaults every sub-field to ''. The
    // legacy handler treats empty string as "user didn't pick one" and
    // SKIPS the key so the server applies its own default. Sending
    // `platform=` on the wire would force the backend into a bad code
    // path.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { data: [], pagination: { limit: 50, offset: 0, total: 0, has_more: false } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: false,
          limit: 50,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    // Only `limit` makes it through; the five filter fields are stripped.
    expect(calls[0].qs).toEqual({ limit: 50 });
  });

  it('clamps limit > 100 down to 100 before sending', async () => {
    // Backend handleGetVideoStats hard-caps limit at 100. The UI clamps via
    // typeOptions.maxValue = 100, but a custom caller can bypass it. The
    // executor MUST defensively clamp to 100 BEFORE the HTTP call.
    // Enforced here.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { data: [], pagination: { limit: 100, offset: 0, total: 0, has_more: false } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: false,
          limit: 500,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(calls[0].qs).toEqual({ limit: 100 });
  });

  it('clamps limit < 1 (or non-numeric) UP to 50 default before sending', async () => {
    // Silently coerces invalid limit values to the 50-default. UI default = 50
    // and minValue = 1, but a custom caller can pass 0 / 'abc' / null / NaN.
// Documents the "default fallback" branch — distinct from the
    // "clamp down >100" branch above.
    for (const badLimit of [0, -5, 'abc', '', null, undefined]) {
      const { fn, calls } = makeRecordingStub('ok', {
        success: true,
        data: { data: [], pagination: { limit: 50, offset: 0, total: 0, has_more: false } },
        meta: {},
      });
      const { ctx } = bindCtx(
        {
          resource: 'video',
          operation: 'getStats',
          params: {
            returnAll: false,
            limit: badLimit as unknown,
            platform: '',
            status: '',
            blogger_username: '',
            sort: '',
            order: '',
          },
        },
        fn,
      );

      await VIDEO_OPERATIONS.getStats.call(ctx, 0);

      expect(calls[0].qs).toEqual({ limit: 50 });
    }
  });

  it('returnAll: true walks data.pagination.has_more until false', async () => {
    // The real /v1/videos/stats endpoint paginates via `offset` + a
    // `has_more` boolean on `data.pagination`. The cursor-aware generic
    // helper influticsApiRequestAllItems reads `meta.next_cursor` instead —
    // so getStats must INLINE the walk to honour the actual contract.
    //
    // Test: 3 pages of 2 items each (has_more=true, true, false), expect
    // exactly 3 calls with offsets 0 → 2 → 4, and a final `{ data: [...] }`
    // envelope carrying all 6 items in arrival order.
    const page1 = {
      data: {
        data: [
          { video_id: 'v-1', views: 1 },
          { video_id: 'v-2', views: 2 },
        ],
        pagination: { limit: 2, offset: 0, total: 6, has_more: true },
      },
    };
    const page2 = {
      data: {
        data: [
          { video_id: 'v-3', views: 3 },
          { video_id: 'v-4', views: 4 },
        ],
        pagination: { limit: 2, offset: 2, total: 6, has_more: true },
      },
    };
    const page3 = {
      data: {
        data: [
          { video_id: 'v-5', views: 5 },
          { video_id: 'v-6', views: 6 },
        ],
        pagination: { limit: 2, offset: 4, total: 6, has_more: false },
      },
    };
    const { fn, calls } = makeSequencedStub([page1, page2, page3]);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: true,
          limit: 2,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(calls).toHaveLength(3);
    expect(calls[0].qs).toEqual({ limit: 2, offset: 0 });
    expect(calls[1].qs).toEqual({ limit: 2, offset: 2 });
    expect(calls[2].qs).toEqual({ limit: 2, offset: 4 });
    expect(result).toEqual({
      data: [
        { video_id: 'v-1', views: 1 },
        { video_id: 'v-2', views: 2 },
        { video_id: 'v-3', views: 3 },
        { video_id: 'v-4', views: 4 },
        { video_id: 'v-5', views: 5 },
        { video_id: 'v-6', views: 6 },
      ],
    });
  });

  it('returnAll: true stops at PAGINATION_MAX_PAGES (50) even if has_more stays true', async () => {
    // Hard cap on the inline walk so a runaway cursor (or a bug in
    // `has_more` reporting) can't DOS the workflow. 50 pages * `limit`
    // items is comfortably above the 1000-row PostgREST cap. Constructs
    // 51 canned responses — first 50 with has_more=true, last one never
    // reached — and asserts the executor bails at exactly 50 calls.
    const pageWithMore = (offset: number) => ({
      data: {
        data: [{ video_id: `v-${offset}`, views: offset }],
        pagination: { limit: 1, offset, total: 999, has_more: true },
      },
    });
    const canned = Array.from({ length: 51 }, (_, i) => pageWithMore(i));
    const { fn, calls } = makeSequencedStub(canned);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: true,
          limit: 1,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(calls).toHaveLength(50);
    expect(calls[49].qs).toEqual({ limit: 1, offset: 49 });
    // Page 51 was NEVER fetched (stub has 51 canned responses, so the
    // recorder only saw 50 — verify by the call count, not the canned
    // length, since the stub caps to last item on overflow).
    expect((result as any).data).toHaveLength(50);
  });

  it('returnAll: true tolerates missing `data.data` wrapper — falls back to `data` as the array', async () => {
    // The legacy executor accepts `response.data` as the array when
    // `response.data.data` is missing. If a future API revision drops the
    // inner wrapper, the items extraction MUST keep working. The
    // pagination walk requires `data.pagination` so the legacy executor
    // bails after the first page in this shape — pinned here so any
    // future widening of the tolerance is a deliberate change, not an
    // accidental drift.
    const page1 = {
      // No inner `.data` wrapper — the array sits directly under
      // `response.data`. The handler MUST extract these 2 items.
      data: [
        { video_id: 'v-1', views: 1 },
        { video_id: 'v-2', views: 2 },
      ],
      // Pagination info isn't available in the wrapper-less shape, so the
      // walk stops after this page.
    };
    const page2 = {
      // Never returned — included only to prove the walk bailed after 1.
      data: { data: [{ video_id: 'v-3', views: 3 }], pagination: { has_more: false } },
    };
    const { fn, calls } = makeSequencedStub([page1, page2]);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: true,
          limit: 2,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    // Walk bailed after 1 page because the missing inner wrapper leaves
    // no `data.pagination` to read. Pins the legacy "items OK, walk
    // stops" behavior.
    expect(calls).toHaveLength(1);
    expect(result).toEqual({
      data: [
        { video_id: 'v-1', views: 1 },
        { video_id: 'v-2', views: 2 },
      ],
    });
  });

  it('returnAll: true returns `{ data: [...] }` envelope shape (single key)', async () => {
    // Single-page paginated case still wraps results in
    // `{ data: collected }`. The downstream n8n consumer expects this
    // shape so a bare-array response would silently break the contract.
    const page1 = {
      data: {
        data: [{ video_id: 'v-1', views: 100 }],
        pagination: { limit: 50, offset: 0, total: 1, has_more: false },
      },
    };
    const { fn } = makeSequencedStub([page1]);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: true,
          limit: 50,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getStats.call(ctx, 0);

    expect(Object.keys(result)).toEqual(['data']);
    expect((result as any).data).toEqual([
      { video_id: 'v-1', views: 100 },
    ]);
  });

  it('propagates a 401 UNAUTHORIZED from the api-request layer', async () => {
    // Bad API key on the wire → mapInfluticsError produces a message
    // starting with `UNAUTHORIZED:`. Handler must propagate untouched so
    // the n8n UI surfaces the code via NodeApiError.description.
    const { fn } = makeRecordingStub('throw401', null);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getStats',
        params: {
          returnAll: false,
          limit: 50,
          platform: '',
          status: '',
          blogger_username: '',
          sort: '',
          order: '',
        },
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.getStats.call(ctx, 0)).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });
});

describe('resources/video — getById', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    const envelope = {
      success: true,
      data: {
        video_id: 'v-1',
        url: 'https://tiktok.com/@a/video/1',
        views: 1000,
        likes: 50,
        status: 'active',
      },
      meta: { processing_time_ms: 4, request_id: 'req-by-id-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getById',
        params: { id: 'v-1' },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getById.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.video_id).toBe('v-1');
    expect((result as any).meta.request_id).toBe('req-by-id-1');
  });

  it('GETs /v1/videos/by-id/{id} with NO qs and NO body', async () => {
    // Wire shape invariant: GET, path-only (URL-encoded id), no qs, no
    // body. Guards against silent drift where a future refactor starts
    // sending qs/body the backend ignores.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-1' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getById',
        params: { id: 'v-1' },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getById.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/videos/by-id/v-1');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toBeUndefined();
  });

  it('URL-encodes special characters in id', async () => {
    // A custom caller (or a future id scheme) might pass a colon. The
    // path would otherwise split on it and 404 in the router. Executor
    // MUST encodeURIComponent the id so reserved chars round-trip.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'vid:1' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getById',
        params: { id: 'vid:1' },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getById.call(ctx, 0);

    expect(calls[0].path).toBe('/v1/videos/by-id/vid%3A1');
  });

  it('throws NodeOperationError when id is empty', async () => {
    // Without an id the URL would be `/v1/videos/by-id/` — backend
    // returns 404 with a confusing URL and no actionable error. Fail
    // fast with a clear UI message and DO NOT make the HTTP call.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-1' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getById',
        params: { id: '' },
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.getById.call(ctx, 0)).rejects.toThrow(
      /Video ID is required/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 404 NOT_FOUND from the api-request layer', async () => {
    // Video ID does not exist OR belongs to a different org. The handler
    // must propagate the message untouched so the n8n UI surfaces the
    // code via NodeApiError.description.
    const { fn } = makeRecordingStub('throw404', null);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getById',
        params: { id: 'missing' },
      },
      fn,
    );

    await expect(VIDEO_OPERATIONS.getById.call(ctx, 0)).rejects.toThrow(
      /NOT_FOUND/,
    );
  });
});

describe('resources/video — getByExternalId', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    const envelope = {
      success: true,
      data: {
        video_id: 'v-2',
        external_id: 'ext-1',
        platform: 'tiktok',
        url: 'https://tiktok.com/@a/video/1',
        views: 5000,
      },
      meta: { processing_time_ms: 6, request_id: 'req-by-ext-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getByExternalId',
        params: { externalId: 'ext-1', platform: 'tiktok' },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.getByExternalId.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.external_id).toBe('ext-1');
    expect((result as any).data.platform).toBe('tiktok');
  });

  it('GETs /v1/videos/by-external-id/{encoded} with NO qs and NO body', async () => {
    // Backend (handleGetVideoByExternalId) reads everything from the
    // URL path; the (organization_id, external_video_id) partial unique
    // index scopes the row. `platform` on the wire would be cruft the
    // backend ignores (the UI marks it required anyway).
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getByExternalId',
        params: { externalId: 'ext-1', platform: 'tiktok' },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getByExternalId.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/videos/by-external-id/ext-1');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toBeUndefined();
  });

  it('URL-encodes special characters in externalId', async () => {
    // Backend `decodeURIComponent` server-side; executor MUST encode the
    // path segment so reserved chars round-trip cleanly.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-3' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getByExternalId',
        params: { externalId: 'ns:ext-1', platform: 'tiktok' },
      },
      fn,
    );

    await VIDEO_OPERATIONS.getByExternalId.call(ctx, 0);

    expect(calls[0].path).toBe('/v1/videos/by-external-id/ns%3Aext-1');
  });

  it('throws NodeOperationError when externalId is empty', async () => {
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getByExternalId',
        params: { externalId: '', platform: 'tiktok' },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.getByExternalId.call(ctx, 0),
    ).rejects.toThrow(/External ID is required/);
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when platform is empty (backend ignores, but UI requires)', async () => {
    // The UI marks `platform` required: true for getByExternalId. The
    // backend ignores the platform anyway, but a workflow that arrived
    // here with an empty platform is broken. Defensive guard before the
    // HTTP call surfaces a clear UI message.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'getByExternalId',
        params: { externalId: 'ext-1', platform: '' },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.getByExternalId.call(ctx, 0),
    ).rejects.toThrow(/Platform is required/);
    expect(calls).toHaveLength(0);
  });
});

describe('resources/video — updateByExternalId', () => {
  it('returns the full server envelope (success/data/meta) untouched on minimal call', async () => {
    const envelope = {
      success: true,
      data: {
        video_id: 'v-2',
        external_id: 'ext-1',
        platform: 'tiktok',
        notes: 'first note',
        updated_at: '2026-08-31T17:00:00Z',
      },
      meta: { processing_time_ms: 9, request_id: 'req-patch-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: { notes: 'first note' },
        },
      },
      fn,
    );

    const result = await VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.notes).toBe('first note');
  });

  it('PATCHs /v1/videos/by-external-id/{encoded} with body { notes } and no qs', async () => {
    // Wire shape invariant: PATCH, path-only (URL-encoded externalId),
    // body carries exactly the non-empty fields. Guards against silent
    // drift where empty fields start going on the wire.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: { notes: 'first note' },
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].path).toBe('/v1/videos/by-external-id/ext-1');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toEqual({ notes: 'first note' });
  });

  it('omits empty string fields from body — "" is NOT sent on the wire', async () => {
    // The n8n UI defaults every text field to ''. The legacy
    // handlePatchVideoByExternalId silently drops empty strings (and an
    // empty body would 400 server-side). Executor MUST strip empties so
    // we never send `campaign: ""` which would mask caller intent.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: {
            notes: 'real note',
            campaign: '',
            status: '',
          },
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0);

    expect(calls[0].body).toEqual({ notes: 'real note' });
  });

  it('omits empty tags array from body — [] is NOT sent on the wire', async () => {
    // Tags is an array; the legacy executor requires a non-empty array.
    // Empty array means "user didn't add any tags" — wire stays minimal.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: { tags: [] },
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/Provide at least one update field/);
    expect(calls).toHaveLength(0);
  });

  it('accepts all 4 fields together — body carries notes + campaign + status + tags', async () => {
    // Wire shape invariant when EVERY field is populated: body carries
    // exactly the four keys, no extras. Guards against silent drift
    // where any of the keys gets dropped between the param map and the
    // wire request.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: {
            notes: 'note text',
            campaign: 'camp-1',
            status: 'running',
            tags: ['alpha', 'beta'],
          },
        },
      },
      fn,
    );

    await VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      notes: 'note text',
      campaign: 'camp-1',
      status: 'running',
      tags: ['alpha', 'beta'],
    });
  });

  it('throws NodeOperationError when externalId is empty', async () => {
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: '',
          platform: 'tiktok',
          updateFields: { notes: 'x' },
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/External ID is required/);
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when platform is empty', async () => {
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: '',
          updateFields: { notes: 'x' },
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/Platform is required/);
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when body is empty (no updateFields)', async () => {
    // An empty body would 400 server-side. Surface a clear
    // NodeOperationError so the user sees a UI message instead of a
    // confusing 400 envelope. The empty-body guard fires when every
    // updateField is empty string / empty array.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
          updateFields: {
            notes: '',
            campaign: '',
            status: '',
            tags: [],
          },
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/Provide at least one update field/);
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when updateFields is missing entirely', async () => {
    // Defensive: the n8n UI guarantees the `updateFields` collection is
    // present, but a custom caller can leave it off. The legacy guard
    // treats missing-as-empty → empty-body guard fires.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { video_id: 'v-2' },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'ext-1',
          platform: 'tiktok',
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/Provide at least one update field/);
    expect(calls).toHaveLength(0);
  });

  it('propagates a 404 NOT_FOUND from the api-request layer', async () => {
    const { fn } = makeRecordingStub('throw404', null);
    const { ctx } = bindCtx(
      {
        resource: 'video',
        operation: 'updateByExternalId',
        params: {
          externalId: 'missing',
          platform: 'tiktok',
          updateFields: { notes: 'x' },
        },
      },
      fn,
    );

    await expect(
      VIDEO_OPERATIONS.updateByExternalId.call(ctx, 0),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});
