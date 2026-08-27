import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import nock from 'nock';
import { mockDeep } from 'vitest-mock-extended';
import type { IExecuteFunctions } from 'n8n-workflow';
import {
  influticsApiRequest,
  influticsApiRequestAllItems,
  mapInfluticsError,
} from '../nodes/GenericFunctions';

const BASE_URL = 'https://api.influtics.com';

describe('GenericFunctions', () => {
  // Block real network so accidental unmocked calls fail loudly.
  beforeAll(() => {
    nock.disableNetConnect();
  });

  // Re-enable for any local debugging (e.g. localstack runs on 127.0.0.1).
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('mapInfluticsError', () => {
    it('maps an API error response into an Error carrying code + message + upgrade URL', () => {
      const error = {
        response: {
          statusCode: 402,
          body: {
            success: false,
            error: {
              code: 'PAID_PLAN_REQUIRED',
              message: 'Upgrade required',
              upgrade_url: 'https://influtics.com/plans',
            },
          },
        },
      };
      const mapped = mapInfluticsError(error);
      expect(mapped.message).toContain('PAID_PLAN_REQUIRED');
      expect(mapped.message).toContain('Upgrade required');
      expect((mapped as any).description).toContain('influtics.com/plans');
    });

    it('passes through non-API errors unchanged', () => {
      const error = new Error('connection refused');
      const mapped = mapInfluticsError(error);
      expect(mapped.message).toContain('connection refused');
    });
  });

  describe('influticsApiRequest', () => {
    let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;
    beforeEach(() => {
      ctx = mockDeep<IExecuteFunctions>();
      ctx.getNode = vi.fn().mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
      ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
      ctx.helpers = {
        // Mirror n8n's real `httpRequestWithAuthentication` with `json: true`:
        //   - 2xx → returns the parsed JSON body directly
        //   - non-2xx → throws an Error whose `.response.body` holds the parsed error body
        // The implementation reads `rawError.response.body.error` via mapInfluticsError.
        httpRequestWithAuthentication: vi.fn(async (_name, opts) => {
          const res = await fetch((opts as any).uri ?? (opts as any).url, {
            method: (opts as any).method ?? 'GET',
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
        }) as any,
      } as any;
    });

    it('returns parsed JSON body on 2xx', async () => {
      nock(BASE_URL).post('/v1/videos/track').reply(200, { success: true, data: { tracked: 3 } });
      const out = await influticsApiRequest.call(ctx as any, 'POST', '/v1/videos/track', {
        urls: ['https://tiktok.com/x'],
      });
      expect(out).toEqual({ success: true, data: { tracked: 3 } });
    });

    it('throws a mapped error on 4xx', async () => {
      nock(BASE_URL).get('/v1/videos/stats').reply(401, {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      });
      await expect(influticsApiRequest.call(ctx as any, 'GET', '/v1/videos/stats')).rejects.toThrow(
        /UNAUTHORIZED/,
      );
    });
  });

  describe('influticsApiRequestAllItems', () => {
    let ctx: ReturnType<typeof mockDeep<IExecuteFunctions>>;
    beforeEach(() => {
      ctx = mockDeep<IExecuteFunctions>();
      ctx.getNode = vi.fn().mockReturnValue({ name: 'InfluticsVideo', type: 'n8n-nodes-influtics.influticsVideo', typeVersion: 1 } as any);
      ctx.getCredentials = vi.fn().mockResolvedValue({ apiKey: 'test-key' });
      ctx.helpers = {
        httpRequestWithAuthentication: vi.fn(async (_name, opts) => {
          const baseUrl = (opts as any).uri ?? (opts as any).url;
          const qs = (opts as any).qs
            ? '?' + new URLSearchParams((opts as any).qs as Record<string, string>).toString()
            : '';
          const res = await fetch(baseUrl + qs, {
            method: (opts as any).method,
            headers: (opts as any).headers,
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

    it('aggregates paginated data across two pages until meta.next_cursor is absent', async () => {
      nock(BASE_URL)
        .get('/v1/videos/stats')
        .query(true)
        .reply(200, {
          success: true,
          data: [{ id: 'v1' }, { id: 'v2' }],
          meta: { next_cursor: 'cur-2' },
        })
        .get('/v1/videos/stats')
        .query({ cursor: 'cur-2' })
        .reply(200, {
          success: true,
          data: [{ id: 'v3' }],
          meta: {},
        });

      const out = await influticsApiRequestAllItems.call(ctx as any, 'GET', '/v1/videos/stats');
      expect(out).toEqual([{ id: 'v1' }, { id: 'v2' }, { id: 'v3' }]);
    });

    it('returns a single page when no cursor is returned', async () => {
      nock(BASE_URL).get('/v1/videos/stats').reply(200, {
        success: true,
        data: [{ id: 'v1' }],
        meta: {},
      });

      const out = await influticsApiRequestAllItems.call(ctx as any, 'GET', '/v1/videos/stats');
      expect(out).toEqual([{ id: 'v1' }]);
    });
  });
});