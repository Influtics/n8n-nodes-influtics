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
import type {
  IDataObject,
  IExecuteFunctions,
  INode,
  INodeExecutionData,
} from 'n8n-workflow';

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
      apiRequest,
    } as unknown as MockContext;
    return ctx;
  };
}
