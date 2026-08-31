/**
 * Tier 2 dispatcher integration smoke tests.
 *
 * Per-resource handler tests (account/blogger/trend/video.test.ts) cover the
 * per-operation wire contract in isolation. This file proves the dispatcher
 * itself routes every (resource, operation) pair to the right handler and
 * throws `NodeOperationError` on unknown values.
 *
 * Wire shape: the dispatcher calls `influticsApiRequest` which internally
 * hits `this.helpers.httpRequestWithAuthentication`. The `makeMockContext`
 * helper builds a context whose `httpRequestWithAuthentication` IS a vitest
 * mock that records every call and returns a canned happy-path envelope
 * so the dispatcher's `[[{ json: response }]]` return shape is stable.
 *
 * nock interceptors are installed for each route as a hygiene / future-proof
 * measure (a future seam change that swaps the in-memory mock for a real
 * fetch would not need test edits), but with the current `makeMockContext`
 * the interceptor is never hit — `httpMock` short-circuits before any network
 * traffic. `nock.cleanAll()` in afterEach reaps any unused interceptors so
 * no test bleed-over.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import nock from 'nock';
import { NodeOperationError } from 'n8n-workflow';
import { executeInflutics } from '../Influtics.node';
import { BASE_URL, makeMockContext } from './helpers/mockContext';

type Route = {
  resource: 'video' | 'blogger' | 'trend' | 'account';
  operation: string;
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
};

const ROUTES: Route[] = [
  { resource: 'video',   operation: 'track',             method: 'POST', path: '/v1/videos/track' },
  { resource: 'video',   operation: 'getStats',          method: 'GET',  path: '/v1/videos/stats' },
  { resource: 'video',   operation: 'getById',           method: 'GET',  path: '/v1/videos/by-id/abc-123' },
  { resource: 'video',   operation: 'getByExternalId',   method: 'GET',  path: '/v1/videos/by-external-id/ext-1' },
  { resource: 'video',   operation: 'updateByExternalId',method: 'PATCH',path: '/v1/videos/by-external-id/ext-1' },
  { resource: 'blogger', operation: 'track',             method: 'POST', path: '/v1/bloggers/track' },
  { resource: 'blogger', operation: 'getJob',            method: 'GET',  path: '/v1/bloggers/jobs/job-1' },
  { resource: 'blogger', operation: 'byUsername',        method: 'GET',  path: '/v1/bloggers/by-username/handle' },
  { resource: 'trend',   operation: 'search',            method: 'GET',  path: '/v1/trends/search' },
  { resource: 'account', operation: 'getUsage',          method: 'GET',  path: '/v1/account/usage' },
  { resource: 'account', operation: 'getLimits',         method: 'GET',  path: '/v1/account/limits' },
];

/**
 * Per-route param prefill. Each operation reads a known set of
 * getNodeParameter() keys at the top of its handler — supply them here so the
 * handler doesn't fail-fast (e.g. required-id guard) BEFORE reaching the
 * HTTP seam. These are NOT a contract test for the handler — the per-resource
 * tests already pin those — they exist solely so the dispatcher test can
 * prove "the dispatcher routed this op to its handler, which then went out
 * the wire".
 */
function paramsFor(route: Route): Record<string, unknown> {
  switch (route.resource) {
    case 'video':
      switch (route.operation) {
        case 'track':
          return { urls: { urls: ['https://tiktok.com/@x/video/1'] } };
        case 'getStats':
          return {};
        case 'getById':
          return { id: 'abc-123' };
        case 'getByExternalId':
          return { externalId: 'ext-1', platform: 'tiktok' };
        case 'updateByExternalId':
          return {
            externalId: 'ext-1',
            platform: 'tiktok',
            updateFields: { notes: 'x' },
          };
      }
      break;
    case 'blogger':
      switch (route.operation) {
        case 'track':
          return { platform: 'tiktok', username: 'handle', initialVideosCount: 10 };
        case 'getJob':
          return { jobId: 'job-1' };
        case 'byUsername':
          return { username: 'handle', platform: 'tiktok' };
      }
      break;
    case 'trend':
      // `additionalFields` is the collection wrapping cursor/region/days.
      // Only `keyword` and `platform` are required for search to fire.
      return { keyword: 'foo', platform: 'tiktok' };
    case 'account':
      return {};
  }
  return {};
}

describe('executeInflutics dispatcher — routing', () => {
  beforeAll(() => {
    // Block real network egress so a future seam change that swaps the
    // in-memory mock for a real fetch surfaces as a clean failure instead
    // of a hanging test. Today the mock short-circuits before any traffic.
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    // Re-enable so tests that intentionally exercise other endpoints (the
    // per-resource suite, e.g.) are not affected across files.
    nock.enableNetConnect();
  });

  it.each(ROUTES)('$resource.$operation routes to its handler', async (route) => {
    const ctx = makeMockContext({
      resource: route.resource,
      operation: route.operation,
      ...paramsFor(route),
    });
    // Hygiene-only: install a matching nock interceptor in case the seam is
    // ever swapped for a real fetch. With the current seam it is unused.
    nock(BASE_URL)
      [route.method.toLowerCase() as 'get'](route.path)
      .reply(200, { success: true, data: {}, meta: {} });

    const out = await executeInflutics.call(ctx as any, [{ json: {} }]);

    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(1);
    expect(out[0][0].json).toBeDefined();
    // The dispatcher MUST have made exactly one wire call (single-batch).
    expect(ctx.httpMock).toHaveBeenCalledTimes(1);
  });

  it('throws NodeOperationError on unknown resource', async () => {
    const ctx = makeMockContext({ resource: 'unknown', operation: 'foo' });

    await expect(
      executeInflutics.call(ctx as any, [{ json: {} }]),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('throws NodeOperationError on unknown operation', async () => {
    const ctx = makeMockContext({ resource: 'video', operation: 'bogus' });

    await expect(
      executeInflutics.call(ctx as any, [{ json: {} }]),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it('dispatches a single batch — one HTTP call per run regardless of input items', async () => {
    // Guards against silent drift where the dispatcher loops over input
    // items and emits N HTTP calls instead of 1.
    const ctx = makeMockContext({
      resource: 'account',
      operation: 'getUsage',
    });
    nock(BASE_URL).get('/v1/account/usage').reply(200, { success: true, data: {} });

    const items = [{ json: {} }, { json: {} }, { json: {} }];
    await executeInflutics.call(ctx as any, items);

    expect(ctx.httpMock).toHaveBeenCalledTimes(1);
  });
});
