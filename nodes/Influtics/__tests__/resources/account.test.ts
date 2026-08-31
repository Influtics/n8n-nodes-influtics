import { describe, it, expect } from 'vitest';
import { ACCOUNT_OPERATIONS } from '../../resources/account';
import {
  mockContext,
  type InfluticsApiRequestFn,
  type MockContextOptions,
} from '../helpers/mockContext';

/**
 * Influtics resource-module tests — Account (Get Usage + Get Limits).
 *
 * The legacy InfluticsAccount node is the source of truth for the backend
 * contract. These tests pin the same wire shape at the dispatcher-handler
 * level so the legacy node can be retired safely later.
 *
 * Both endpoints take no query params and no body. The four-per-op coverage
 * targets (matching the legacy InfluticsAccount.test.ts depth):
 *   1. happy-path: handler returns the full server envelope (success/data/meta)
 *   2. wire-shape: hits the right path with GET, no qs, no body
 *   3. 401 propagates from the api-request layer
 *   4. 429 propagates from the api-request layer
 *
 * The handlers are thin wrappers around `influticsApiRequest`, so we stub the
 * apiRequest at the seam exposed by `mockContext` instead of standing up a
 * real nock + httpRequestWithAuthentication chain. This keeps the assertions
 * focused on the handler's responsibility: it calls the right endpoint with
 * the right shape and propagates whatever the api layer returns or throws.
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
 */
function makeRecordingStub(
  mode: 'ok' | 'throw401' | 'throw429',
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
    if (mode === 'throw401' || mode === 'throw429') {
      // The real influticsApiRequest catches the helper error, extracts
      // { code, message } from rawError.response.body.error via
      // mapInfluticsError, and rethrows a NodeApiError whose .message starts
      // with the code. Stub to throw the same shape so the handler-under-test
      // can be observed propagating it untouched.
      const err: any = new Error(
        mode === 'throw401'
          ? 'UNAUTHORIZED: Invalid or revoked API key.'
          : 'RATE_LIMITED: Credits limit exceeded',
      );
      throw err;
    }
    return canned as any;
  };
  return { fn, calls };
}

describe('resources/account — getUsage', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // The handler MUST NOT unwrap the envelope — downstream n8n consumers
    // see exactly what the API sent (mirrors the Track / Get Stats
    // patterns). The data sub-tree is asserted structurally so any silent
    // drift in summary shape breaks the contract.
    const envelope = {
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
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getUsage', params: {} },
      fn,
    );

    const result = await ACCOUNT_OPERATIONS.getUsage.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data).toEqual(envelope.data);
    expect((result as any).meta.request_id).toBe('req-usage-1');
  });

  it('GETs /v1/account/usage with NO qs and NO body', async () => {
    // Public docs: https://docs.influtics.com/ — Get Usage reads no query
    // params and no body. Guard against silent drift where the URL is right
    // but the helper starts sending qs/body the backend ignores.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { usage_history: [], summary: {} },
      meta: {},
    });
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getUsage', params: {} },
      fn,
    );

    await ACCOUNT_OPERATIONS.getUsage.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/account/usage');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toBeUndefined();
  });

  it('propagates a 401 UNAUTHORIZED from the api-request layer', async () => {
    // Bad API key on the wire → mapInfluticsError produces a message
    // starting with `UNAUTHORIZED:`. The handler must NOT swallow this —
    // the n8n UI surfaces the code via NodeApiError.description.
    const { fn } = makeRecordingStub('throw401', null);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getUsage', params: {} },
      fn,
    );

    await expect(ACCOUNT_OPERATIONS.getUsage.call(ctx, 0)).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });

  it('propagates a 429 RATE_LIMITED from the api-request layer', async () => {
    // Same propagation contract for the 429 path — handler must let
    // mapInfluticsError's `RATE_LIMITED:` message bubble untouched.
    const { fn } = makeRecordingStub('throw429', null);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getUsage', params: {} },
      fn,
    );

    await expect(ACCOUNT_OPERATIONS.getUsage.call(ctx, 0)).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });
});

describe('resources/account — getLimits', () => {
  it('returns the full server envelope (success/data/meta) untouched', async () => {
    // Same envelope-preservation contract as getUsage. Fixture mirrors the
    // documented server-side defaults so the executor's surface contract
    // stays the same regardless of which path the server took to fill
    // them in.
    const envelope = {
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
    };
    const { fn } = makeRecordingStub('ok', envelope);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getLimits', params: {} },
      fn,
    );

    const result = await ACCOUNT_OPERATIONS.getLimits.call(ctx, 0);

    expect(result).toEqual(envelope);
    expect((result as any).data).toEqual(envelope.data);
    expect((result as any).meta.request_id).toBe('req-limits-1');
  });

  it('GETs /v1/account/limits with NO qs and NO body', async () => {
    // Same wire-shape invariant as getUsage — no qs, no body, right path,
    // right method.
    const { fn, calls } = makeRecordingStub('ok', {
      success: true,
      data: { rate_limits: {} },
      meta: {},
    });
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getLimits', params: {} },
      fn,
    );

    await ACCOUNT_OPERATIONS.getLimits.call(ctx, 0);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].path).toBe('/v1/account/limits');
    expect(calls[0].qs).toBeUndefined();
    expect(calls[0].body).toBeUndefined();
  });

  it('propagates a 401 UNAUTHORIZED from the api-request layer', async () => {
    const { fn } = makeRecordingStub('throw401', null);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getLimits', params: {} },
      fn,
    );

    await expect(ACCOUNT_OPERATIONS.getLimits.call(ctx, 0)).rejects.toThrow(
      /UNAUTHORIZED/,
    );
  });

  it('propagates a 429 RATE_LIMITED from the api-request layer', async () => {
    const { fn } = makeRecordingStub('throw429', null);
    const { ctx } = bindCtx(
      { resource: 'account', operation: 'getLimits', params: {} },
      fn,
    );

    await expect(ACCOUNT_OPERATIONS.getLimits.call(ctx, 0)).rejects.toThrow(
      /RATE_LIMITED/,
    );
  });
});
