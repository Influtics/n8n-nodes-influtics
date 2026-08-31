import { describe, it, expect } from 'vitest';
import { TREND_OPERATIONS } from '../../resources/trend';
import {
  mockContext,
  type InfluticsApiRequestFn,
  type MockContextOptions,
} from '../helpers/mockContext';

/**
 * Influtics resource-module tests — Trend (Search).
 *
 * Backend contract verified against api-worker `trendsHandler.js`.
 *
 * Fourteen tests cover the Search operation end-to-end:
 *   (a) happy path: keyword + platform minimal → full envelope
 *   (b) happy path: all optional fields forwarded to qs
 *   (c) wire shape: GET /v1/trends/search with correct qs
 *   (d) trims keyword whitespace before sending
 *   (e) omits empty optional fields (cursor/region/days = '' NOT on wire)
 *   (f) NodeOperationError on missing keyword
 *   (g) NodeOperationError on invalid platform
 *   (h) NodeOperationError on invalid region
 *   (i) NodeOperationError on invalid days
 *   (j) propagates 401 UNAUTHORIZED
 *   (k) propagates 402 PAID_PLAN_REQUIRED
 *   (l) propagates 429 RATE_LIMITED
 *
 * The handler is a thin wrapper around `influticsApiRequest`, so we stub the
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
 *   - 'throw401' / 'throw402' / 'throw429' → throw an Error whose message
 *     starts with the documented backend code. The real `influticsApiRequest`
 *     catches the helper error, extracts `{ code, message }` via
 *     `mapInfluticsError`, and rethrows a NodeApiError whose `.message` starts
 *     with the code. The stub throws the same shape so the handler-under-test
 *     can be observed propagating it untouched.
 */
function makeRecordingStub(
  mode: 'ok' | 'throw401' | 'throw402' | 'throw429',
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
          : mode === 'throw402'
          ? 'PAID_PLAN_REQUIRED: A paid plan is required to use this endpoint.'
          : 'RATE_LIMITED: Credits limit exceeded';
      const err: any = new Error(message);
      throw err;
    }
    return canned as any;
  };
  return { fn, calls };
}

describe('resources/trend — search', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // The handler MUST NOT unwrap the envelope — downstream n8n consumers
    // see exactly what the API sent (mirrors the Track / Get Stats
    // patterns). The data sub-tree is asserted structurally so any silent
    // drift in trend shape breaks the contract.
    const envelope = {
      success: true,
      data: {
        trends: [
          { keyword: 'fidget spinner', score: 91, region: 'US', platform: 'tiktok' },
          { keyword: 'fidget cube', score: 42, region: 'US', platform: 'tiktok' },
        ],
        meta: { total: 2, next_cursor: null },
      },
      meta: { processing_time_ms: 88, request_id: 'req-trend-1' },
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'tiktok' },
      },
      fn,
    );

    const result = await TREND_OPERATIONS.search.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data.trends).toHaveLength(2);
    expect((result as any).meta.request_id).toBe('req-trend-1');
  });

  it('forwards all optional fields (cursor + region + days) onto qs', async () => {
    // When the user picks every additional option the URL must carry every
    // option. Guards against silent drift where one of the three keys gets
    // dropped between the param map and the wire request.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { trends: [], meta: { total: 0, next_cursor: null } },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: {
          keyword: 'fidget',
          platform: 'youtube',
          additionalFields: { cursor: 'cur-abc', region: 'JP', days: '7' },
        },
      },
      fn,
    );

    await TREND_OPERATIONS.search.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].qs).toEqual({
      keyword: 'fidget',
      platform: 'youtube',
      cursor: 'cur-abc',
      region: 'JP',
      days: '7',
    });
  });

  it('GETs /v1/trends/search with the minimal (keyword + platform) qs and no body', async () => {
    // Wire shape invariant: right path, right method, no body, qs carries
    // exactly the required keys when the user picks no additional options.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { trends: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'tiktok' },
      },
      fn,
    );

    await TREND_OPERATIONS.search.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/trends/search');
    expect(calls[0].qs).toEqual({ keyword: 'fidget', platform: 'tiktok' });
    expect(calls[0].body).toBeUndefined();
  });

  it('trims keyword whitespace before sending on the wire', async () => {
    // Trims `keyword.trim()` before adding it to the qs. A user who pastes
    // `"  fidget  "` must NOT send leading or trailing whitespace to the
    // backend.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { trends: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: '   fidget   ', platform: 'tiktok' },
      },
      fn,
    );

    await TREND_OPERATIONS.search.call(ctx, 0);

    expect(calls[0].qs).toEqual({ keyword: 'fidget', platform: 'tiktok' });
  });

  it('omits empty optional fields — cursor/region/days = "" are NOT sent on the wire', async () => {
    // The n8n UI collection field defaults every sub-field to ''. The legacy
    // handler treats empty string as "user didn't pick one" and SKIPS the key
    // so the server applies its own default. Sending `cursor=` on the wire
    // would force the backend into a bad code path.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { trends: [] },
      meta: {},
    });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: {
          keyword: 'fidget',
          platform: 'tiktok',
          additionalFields: { cursor: '', region: '', days: '' },
        },
      },
      fn,
    );

    await TREND_OPERATIONS.search.call(ctx, 0);

    expect(calls[0].qs).toEqual({ keyword: 'fidget', platform: 'tiktok' });
  });

  it('throws NodeOperationError when keyword is missing', async () => {
    // The backend rejects missing keyword with 400 VALIDATION_ERROR — fail
    // fast with a clear UI message instead of letting the workflow silently
    // 400. Message text is what the user sees on validation failure —
    // keep it user-facing.
    const { fn } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: '', platform: 'tiktok' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /Keyword is required/,
    );
  });

  it('throws NodeOperationError when keyword is only whitespace', async () => {
    // `   ` is non-empty but semantically empty after trim — must still
    // throw. Guards against the handler skipping the trim check when the
    // user pastes a stray space.
    const { fn } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: '     ', platform: 'tiktok' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /Keyword is required/,
    );
  });

  it('throws NodeOperationError when platform is invalid', async () => {
    // The UI dropdown only exposes tiktok/youtube, but the backend's
    // VALID_PLATFORMS guard catches anything else (e.g. legacy workflows
    // that hard-coded 'instagram'). The handler must reject with a clear
    // allowlist message BEFORE the HTTP call.
    const { fn, calls } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'instagram' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /Platform must be one of: tiktok, youtube/,
    );
    // Defensive: the guard MUST run before the HTTP call. If the apiRequest
    // was invoked the backend would already have rejected — we want the
    // handler to fail fast with a NodeOperationError instead.
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when region is not a 2-letter ISO 3166-1 code', async () => {
    // Backend REGION_REGEX = /^[A-Za-z]{2}$/. A 3-letter code ('USA') or a
    // digit ('1') must throw BEFORE the HTTP call so the user sees a UI
    // message instead of a 400 envelope. The legacy guard fires when
    // `additionalFields.region` is truthy AND fails the regex.
    const { fn, calls } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: {
          keyword: 'fidget',
          platform: 'tiktok',
          additionalFields: { region: 'USA' },
        },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /two-letter ISO 3166-1 code/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when region is a single digit', async () => {
    // Same regex; single digit fails the {2} quantifier. Documents that the
    // check is structural, not "alpha-only".
    const { fn, calls } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: {
          keyword: 'fidget',
          platform: 'tiktok',
          additionalFields: { region: '1' },
        },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /two-letter ISO 3166-1 code/,
    );
    expect(calls).toHaveLength(0);
  });

  it('throws NodeOperationError when days is not in the allow-list', async () => {
    // Backend VALID_DAYS = ['0','1','7','30','90','180']. '14' is a valid
    // integer but outside the allow-list — must fail fast with the
    // documented message. Empty string is NOT a guard violation (it's the
    // "user didn't pick one" sentinel).
    const { fn, calls } = makeRecordingStub('ok', { success: true, data: {}, meta: {} });
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: {
          keyword: 'fidget',
          platform: 'tiktok',
          additionalFields: { days: '14' },
        },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /Days must be one of: 0, 1, 7, 30, 90, 180/,
    );
    expect(calls).toHaveLength(0);
  });

  it('propagates a 401 UNAUTHORIZED from the api-request layer', async () => {
    // Bad API key on the wire → mapInfluticsError produces a message
    // starting with `UNAUTHORIZED:`. The handler must NOT swallow this —
    // the n8n UI surfaces the code via NodeApiError.description.
    const { fn } = makeRecordingStub('throw401', null);
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'tiktok' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });

  it('propagates a 402 PAID_PLAN_REQUIRED from the api-request layer', async () => {
    // Trends search is a paid-only endpoint (1 credit per call). Free-tier
    // callers receive 402 PAID_PLAN_REQUIRED. The handler must propagate
    // the message so the n8n UI can show the upgrade URL via the
    // description field.
    const { fn } = makeRecordingStub('throw402', null);
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'tiktok' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /PAID_PLAN_REQUIRED/,
    );
  });

  it('propagates a 429 RATE_LIMITED from the api-request layer', async () => {
    // Same propagation contract for the 429 path — handler must let
    // mapInfluticsError's `RATE_LIMITED:` message bubble untouched.
    const { fn } = makeRecordingStub('throw429', null);
    const { ctx } = bindCtx(
      {
        resource: 'trend',
        operation: 'search',
        params: { keyword: 'fidget', platform: 'tiktok' },
      },
      fn,
    );

    await expect(TREND_OPERATIONS.search.call(ctx, 0)).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });
});
