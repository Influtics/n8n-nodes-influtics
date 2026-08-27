/**
 * Influtics Account node.
 *
 * Implementation choices:
 * - File lives at nodes/InfluticsAccount/InfluticsAccount.node.ts — required by
 *   the eslint-plugin-n8n-nodes-base `node-dirname-against-convention` rule.
 * - `executeInfluticsAccount` is also exported as a named function so unit tests
 *   can drive the executor without instantiating the INodeType class.
 * - Two read-only operations: Get Usage + Get Limits. Both endpoints take no
 *   user input (no query params, no body) — there is nothing to guard against
 *   on the wire, so neither handler needs defensive validation.
 * - Both endpoints cost 0 credits and are exempt from the paid-plan gate,
 *   so free-tier callers can reach them. Public docs:
 *   https://docs.influtics.com/
 * - The unimplemented-operation branch keeps the executor safe if a future
 *   version's parameters somehow leak an unknown value.
 *
 * Backend contract (public docs: https://docs.influtics.com/):
 *   GET /v1/account/usage
 *     query: NONE. body: NONE.
 *     200 → {
 *       success: true,
 *       data: {
 *         usage_history: [...rows from daily_api_usage over the last 30 days...],
 *         summary: {
 *           plan: "free"|"pro"|"business"|null,
 *           is_unlimited: boolean,
 *           videos: { limit: number|null, used: number|null },
 *           credits: { total: number, used: number }
 *         }
 *       },
 *       meta: { processing_time_ms, request_id }
 *     }
 *     Errors: 401 UNAUTHORIZED, 429 RATE_LIMITED.
 *
 *   GET /v1/account/limits
 *     query: NONE. body: NONE.
 *     200 → {
 *       success: true,
 *       data: {
 *         rate_limits: {
 *           requests_per_minute: number,
 *           requests_per_hour: number,
 *           requests_per_day: number,
 *           requests_per_month: number,
 *           burst_allowance: number
 *         }
 *       },
 *       meta: { processing_time_ms, request_id }
 *     }
 *     Server-side default rate limits (when no override is configured):
 *       { requests_per_minute: 60, requests_per_hour: 3600,
 *         requests_per_day: 86400, requests_per_month: 10000,
 *         burst_allowance: 120 }.
 *     Errors: 401 UNAUTHORIZED, 429 RATE_LIMITED.
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from '../GenericFunctions';

// Per-operation handler map. Neither endpoint takes user input — both are
// single-batch, no-params GETs. Same pattern as InfluticsVideo/InfluticsBlogger
// for future-proofing: adding a new operation means adding a key + test here
// without growing the executor's else-if chain.
type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

const OPERATIONS: Record<string, OperationHandler> = {
  getUsage: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    // No input → no defensive guards needed. The executor calls the API
    // directly and returns the raw envelope so downstream n8n consumers see
    // exactly what the API sent (mirrors the Track / Get Stats patterns).
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/usage');
    return response as IDataObject;
  },
  getLimits: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    // No input → no defensive guards needed. Same wire shape as Get Usage:
    // a single GET with no qs / no body.
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/limits');
    return response as IDataObject;
  },
};

export async function executeInfluticsAccount(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not yet implemented in InfluticsAccount node`,
    );
  }
  // Both ops are single-batch: one GET per workflow run regardless of input
  // item count. Mirrors the Track-videos and Track-bloggers single-batch
  // pattern from InfluticsVideo / InfluticsBlogger.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class InfluticsAccount implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Account',
    name: 'influticsAccount',
    icon: { light: 'file:influtics.svg', dark: 'file:influtics.svg' },
    group: ['transform'],
    version: 1,
    description: 'Read Influtics account usage and limits',
    // eslint-plugin-n8n-nodes-base `node-class-description-missing-subtitle`
    // requires a subtitle when every property is `displayName: 'Operation'`
    // (sibling nodes like InfluticsVideo skip the rule because they have
    // additional non-Operation fields). Map the raw operation value to its
    // displayName so the canvas renders the friendly name rather than the
    // enum value.
    subtitle:
      '={{ $parameter["operation"] === "getUsage" ? "Get Usage" : "Get Limits" }}',
    defaults: { name: 'Influtics Account' },
    inputs: ['main'],
    outputs: ['main'],
    usableAsTool: true,
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        // Alphabetized per eslint-plugin-n8n-nodes-base `node-param-options-type-unsorted-items`.
        // Each option carries an `action:` (rule `node-param-operation-option-action-miscased`).
        options: [
          {
            name: 'Get Limits',
            value: 'getLimits',
            description: 'Read rate limit configuration',
            action: 'Read rate limit configuration',
          },
          {
            name: 'Get Usage',
            value: 'getUsage',
            description: 'Read usage history and subscription summary',
            action: 'Read usage history and subscription summary',
          },
        ],
        default: 'getUsage',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsAccount.call(this, this.getInputData());
  }
}
