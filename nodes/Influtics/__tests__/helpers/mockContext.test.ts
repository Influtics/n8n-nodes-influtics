import { describe, expect, it } from 'vitest';
import { mockContext, type InfluticsApiRequestFn } from './mockContext';

describe('mockContext', () => {
  it('returns the bound resource + operation to getNodeParameter', () => {
    const bind = mockContext({
      resource: 'account',
      operation: 'getUsage',
      params: {},
    });
    const stub: InfluticsApiRequestFn = async () => ({});
    const ctx = bind(stub);

    expect(ctx.getNodeParameter('resource', 0)).toBe('account');
    expect(ctx.getNodeParameter('operation', 0)).toBe('getUsage');
  });

  it('returns the supplied param value for a per-op name', () => {
    const bind = mockContext({
      resource: 'video',
      operation: 'track',
      params: { urls: { urls: ['https://tiktok.com/@x/video/1'] } },
    });
    const stub: InfluticsApiRequestFn = async () => ({});
    const ctx = bind(stub);

    expect(ctx.getNodeParameter('urls', 0)).toEqual({
      urls: ['https://tiktok.com/@x/video/1'],
    });
  });

  it('falls back to the default when a param is missing', () => {
    const bind = mockContext({
      resource: 'video',
      operation: 'getStats',
      params: {},
    });
    const stub: InfluticsApiRequestFn = async () => ({});
    const ctx = bind(stub);

    expect(ctx.getNodeParameter('platform', 0, '')).toBe('');
  });

  it('exposes a fixed test node skeleton via getNode', () => {
    const bind = mockContext({
      resource: 'blogger',
      operation: 'byUsername',
      params: {},
    });
    const stub: InfluticsApiRequestFn = async () => ({});
    const ctx = bind(stub);

    const node = ctx.getNode();
    expect(node.name).toBe('Influtics');
    expect(node.typeVersion).toBe(2);
    expect(node.type).toBe('n8n-nodes-influtics.influtics');
  });

  it('ignores params keys that collide with resource/operation', () => {
    const bind = mockContext({
      resource: 'account',
      operation: 'getUsage',
      // Collision attempt: even if a caller passes resource/operation in params,
      // the bound options.resource / options.operation must win. Otherwise the
      // dispatcher's this.getNodeParameter('resource', 0) would route to the wrong
      // handler after any future refactor drops the explicit guards.
      params: { resource: 'video', operation: 'track' },
    });
    const stub: InfluticsApiRequestFn = async () => ({});
    const ctx = bind(stub);

    expect(ctx.getNodeParameter('resource', 0)).toBe('account');
    expect(ctx.getNodeParameter('operation', 0)).toBe('getUsage');
  });
});
