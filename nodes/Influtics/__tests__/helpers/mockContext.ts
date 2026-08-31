/**
 * Shared IExecuteFunctions mock for Influtics resource-module tests.
 *
 * The new Influtics dispatcher calls:
 *   - this.getNodeParameter('resource', 0)
 *   - this.getNodeParameter('operation', 0)
 *   - this.getNodeParameter(<param>, i, default?)
 *   - this.getNode()                  // for NodeOperationError context
 *   - this.getInputData()             // dispatcher reads but does not iterate
 *   - influticsApiRequest.call(this, METHOD, path, body?, qs?)
 *
 * mockContext({ resource, operation, params }) returns a function that
 * satisfies the `this: IExecuteFunctions` binding the operation handlers use.
 * The returned function takes a single `influticsApiRequest` argument so each
 * test can stub the HTTP layer with nock (the project already uses nock for
 * the legacy node tests — keep the same approach).
 */
import { vi } from 'vitest';
import type {
  IDataObject,
  IExecuteFunctions,
  INode,
  INodeExecutionData,
} from 'n8n-workflow';
import { INFLUTICS_API_BASE_URL } from '../../../GenericFunctions';

/**
 * Re-export of the production base URL so dispatcher tests can target nock
 * interceptors at the same origin the real worker hits. Pure re-export; no
 * test should hard-code the URL string.
 */
export const BASE_URL = INFLUTICS_API_BASE_URL;

/** Signature of influticsApiRequest — what handlers actually call. */
export type InfluticsApiRequestFn = (
  this: IExecuteFunctions,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: IDataObject,
  qs?: IDataObject,
) => Promise<IDataObject>;

export type MockContextOptions = {
  resource: 'account' | 'blogger' | 'trend' | 'video';
  operation: string;
  /**
   * Parameter map; values are returned by getNodeParameter(name, i, default?).
   * Keys named 'resource' or 'operation' are ignored — those are bound by the
   * top-level fields above and win unconditionally.
   */
  params: Record<string, unknown>;
};

export type MockContext = IExecuteFunctions & {
  /** Test seam: replaces influticsApiRequest. */
  apiRequest: InfluticsApiRequestFn;
};

/**
 * Build a fake IExecuteFunctions bound to a fixed (resource, operation, params)
 * triple. Returned function takes the real `influticsApiRequest` and returns
 * a context that proxies every n8n-workflow call to either the parameter map
 * (for getNodeParameter) or a fixed node skeleton (everything else).
 *
 * Usage in a test:
 *   const ctx = mockContext({
 *     resource: 'account',
 *     operation: 'getUsage',
 *     params: {},
 *   });
 *   await ACCOUNT_OPERATIONS.getUsage.call(ctx(apiRequestStub), 0);
 */
export function mockContext(options: MockContextOptions) {
  const node: INode = {
    id: 'test-node-id',
    name: 'Influtics',
    type: 'n8n-nodes-influtics.influtics',
    typeVersion: 2,
    position: [0, 0],
    parameters: { resource: options.resource, operation: options.operation },
  } as unknown as INode;

  const inputData: INodeExecutionData[] = [{ json: {} }];

  return function bind(apiRequest: InfluticsApiRequestFn): MockContext {
    const ctx: MockContext = {
      getNodeParameter(name: string, _i: number, fallback?: unknown) {
        if (name === 'resource') return options.resource;
        if (name === 'operation') return options.operation;
        if (Object.prototype.hasOwnProperty.call(options.params, name)) {
          return options.params[name];
        }
        return fallback;
      },
      getNode() {
        return node;
      },
      getInputData() {
        return inputData;
      },
      getCredentials(_type: string) {
        // Operations do not read credentials directly — influticsApiRequest
        // does — but the type requires this method. Return an empty object
        // so accidental reads are visible (no silent undefined spread).
        return Promise.resolve({});
      },
      // Resource handlers route every HTTP call through
      // `influticsApiRequest.call(this, METHOD, path, body?, qs?)`, which
      // internally calls `this.helpers.httpRequestWithAuthentication.call(
      // this, CREDENTIAL_NAME, options )`. To make the test seam ergonomic
      // we expose a single `apiRequest` stub and wrap it so the real
      // GenericFunctions path reaches it untouched. This keeps the
      // resource-module tests honest about the actual call chain while
      // letting each test record calls / inject canned responses / throw
      // canned errors without standing up a nock + fetch loop.
      helpers: {
        httpRequestWithAuthentication: (async (
          _credName: string,
          opts: { method: string; url: string; body?: unknown; qs?: unknown },
        ) => {
          // Parse `url: https://api.influtics.com/v1/account/usage` back
          // into method=GET + path=/v1/account/usage to match what a real
          // handler would see if it called apiRequest directly.
          const url = new URL(opts.url);
          return apiRequest.call(
            ctx as unknown as IExecuteFunctions,
            opts.method as InfluticsApiRequestFn extends (...a: infer A) => any
              ? A[0]
              : never,
            url.pathname,
            opts.body as IDataObject | undefined,
            opts.qs as IDataObject | undefined,
          );
        }) as any,
      },
      apiRequest,
    } as unknown as MockContext;
    return ctx;
  };
}

/**
 * MakeMockContext — convenience wrapper for dispatcher-level integration tests
 * (where the dispatcher exercises `influticsApiRequest`, which in turn hits
 * `helpers.httpRequestWithAuthentication`).
 *
 * The seam in `mockContext()` builds its OWN `httpRequestWithAuthentication`
 * closure that routes through a caller-supplied apiRequest stub. That's the
 * right shape for per-handler unit tests (resource/{name}.test.ts) but it
 * hides the dispatcher's per-call HTTP shape — which is what dispatcher
 * tests need to assert against.
 *
 * `makeMockContext` accepts a single flat params map, pulls `resource` /
 * `operation` out as the bound operation triple, and builds a context whose
 * `helpers.httpRequestWithAuthentication` IS a vitest mock so callers can
 * inspect `.mock.calls.length`. The mock records every call and returns a
 * canned happy-path response; the dispatcher wraps that into the standard
 * `[[{ json: response }]]` return shape so callers can assert on
 * `out[0][0].json`.
 *
 * The seam extension is the only divergence from `mockContext()` — the
 * parameter map, node skeleton, inputData, and getCredentials all behave
 * identically so a handler moved from a per-resource test to a dispatcher
 * test sees the same parameter view.
 */
export type MakeMockContextParams = {
  /**
   * Resource key. Defaults to `'video'`. Intentionally typed as `string`
   * (not the narrower `'account' | 'blogger' | 'trend' | 'video'` union) so
   * dispatcher tests can deliberately pass unknown values to verify the
   * dispatcher's `NodeOperationError` branch.
   */
  resource?: string;
  operation?: string;
  [key: string]: unknown;
};

export type MockContextWithHttpMock = MockContext & {
  /**
   * Direct handle on the underlying vi.fn for assertions that go beyond
   * `mock.calls.length` (e.g. inspecting the actual options passed to the
   * helper). This is the SAME object as `ctx.helpers.httpRequestWithAuthentication`.
   */
  httpMock: ReturnType<typeof vi.fn>;
};

export function makeMockContext(
  params: MakeMockContextParams = {},
): MockContextWithHttpMock {
  const {
    resource = 'video',
    operation = 'track',
    ...rest
  } = params;

  const node: INode = {
    id: 'test-node-id',
    name: 'Influtics',
    type: 'n8n-nodes-influtics.influtics',
    typeVersion: 2,
    position: [0, 0],
    parameters: { resource, operation },
  } as unknown as INode;

  const inputData: INodeExecutionData[] = [{ json: {} }];

  // Records every dispatch call and returns a happy-path envelope so the
  // dispatcher's `[[{ json: response }]]` return shape is stable. nock
  // interceptors that the test installs DO NOT intercept this — nock only
  // captures real network traffic — but they also don't conflict, since
  // nock.cleanAll() in afterEach will reap them harmlessly.
  const httpMock = vi.fn(
    async (
      _credName: string,
      _opts: { method: string; url: string; body?: unknown; qs?: unknown },
    ): Promise<IDataObject> => ({ success: true, data: {}, meta: {} }),
  );

  const ctx: MockContext = {
    getNodeParameter(name: string, _i: number, fallback?: unknown) {
      if (name === 'resource') return resource;
      if (name === 'operation') return operation;
      if (Object.prototype.hasOwnProperty.call(rest, name)) {
        return rest[name];
      }
      return fallback;
    },
    getNode() {
      return node;
    },
    getInputData() {
      return inputData;
    },
    getCredentials(_type: string) {
      return Promise.resolve({});
    },
    helpers: {
      httpRequestWithAuthentication: httpMock as any,
    },
    // The dispatcher only goes through `influticsApiRequest` →
    // `helpers.httpRequestWithAuthentication`. The `apiRequest` field on
    // MockContext is for the per-resource test seam (which DOES call it
    // directly), so expose the same shape — here it's a no-op shim because
    // nothing under test calls `ctx.apiRequest` in this test layer.
    apiRequest: (async () => ({})) as unknown as InfluticsApiRequestFn,
  } as unknown as MockContext;

  return Object.assign(ctx, { httpMock });
}
