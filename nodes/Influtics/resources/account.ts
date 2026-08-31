/**
 * Account resource module for the Influtics single-action node.
 *
 * Public docs: https://docs.influtics.com/
 *   GET /v1/account/usage   → { data: { usage_history, summary } }
 *   GET /v1/account/limits  → { data: { rate_limits } }
 *
 * Both endpoints are read-only single-batch GETs that take no query params
 * and no body. Because both endpoints take no user input, the operation
 * dropdown is the only INodeProperties entry the module contributes — no
 * per-op fields.
 */
import type { IDataObject, IExecuteFunctions, INodeProperties } from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

export const ACCOUNT_OPERATIONS: Record<string, OperationHandler> = {
  // Get Usage — single GET, no qs, no body. The executor calls the API
  // directly and returns the raw envelope so downstream n8n consumers see
  // exactly what the API sent (mirrors the Track / Get Stats patterns).
  getUsage: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/usage');
    return response as IDataObject;
  },

  // Get Limits — same wire shape as Get Usage: a single GET with no qs / no
  // body. Server-side defaults documented at https://docs.influtics.com/.
  getLimits: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const response = await influticsApiRequest.call(this, 'GET', '/v1/account/limits');
    return response as IDataObject;
  },
};

export function accountProperties(): INodeProperties[] {
  return [
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      // Alphabetized per eslint-plugin-n8n-nodes-base
      // `node-param-options-type-unsorted-items`. Each option carries an
      // `action:` (rule `node-param-operation-option-action-miscased`).
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
      // Scoped to resource=account so the dropdown does not leak into
      // Blogger / Trend / Video renders. The dispatcher spreads every
      // resource module's properties into the same INodeTypeDescription,
      // so the operation dropdown stays scoped to the selected Resource.
      displayOptions: { show: { resource: ['account'] } },
    },
  ];
}
