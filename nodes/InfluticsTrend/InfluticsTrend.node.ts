/**
 * Influtics Trend node.
 *
 * Implementation choices:
 * - File lives at nodes/InfluticsTrend/InfluticsTrend.node.ts — required by the
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention` rule.
 * - `executeInfluticsTrend` is also exported as a named function so unit tests
 *   can drive the executor without instantiating the INodeType class.
 * - One operation: Search. Tracks TikTok/YouTube trends by keyword. Tasks
 *   4/5/6/7 ship the Video and Blogger siblings; this node (Task 8) adds
 *   the trends side.
 * - The unimplemented-operation branch keeps the executor safe if a future
 *   version's parameters somehow leak an unknown value.
 *
 * Backend contract (verified against api-worker `trendsHandler.js`):
 *   GET /v1/trends/search
 *     query (REQUIRED):
 *       - keyword  : string, non-empty after trim
 *       - platform : one of `tiktok`, `youtube`
 *     query (OPTIONAL):
 *       - cursor : pagination cursor returned by prior call
 *       - region : ISO 3166-1 alpha-2 country code (e.g. `US`, `DE`, `JP`)
 *                  validated server-side with `/^[A-Za-z]{2}$/`
 *       - days   : one of `0, 1, 7, 30, 90, 180` (0 = "no time window")
 *     Cost: 1 credit per call (free-tier callers receive 402 PAID_PLAN_REQUIRED).
 *     Errors: 400 VALIDATION_ERROR, 401 UNAUTHORIZED, 402 PAID_PLAN_REQUIRED,
 *             429 RATE_LIMITED.
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

// Per-operation handler map. Even with one operation today, use the map for
// pattern consistency with the InfluticsVideo / InfluticsBlogger nodes —
// future operations (Task N) add a key + tests here without growing the
// executor's else-if chain.
type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

// Backend hard allow-list (mirrors `VALID_DAYS` in
// api-worker/src/handlers/trendsHandler.js). The UI exposes these as a
// dropdown so the user can't pick anything else; this is defense-in-depth
// against custom callers / future schema drift.
const VALID_DAYS = ['0', '1', '7', '30', '90', '180'];
const VALID_PLATFORMS = ['tiktok', 'youtube'];
// ISO 3166-1 alpha-2 — two letters. Matches the server-side regex.
const REGION_REGEX = /^[A-Za-z]{2}$/;

const OPERATIONS: Record<string, OperationHandler> = {
  search: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const keyword = this.getNodeParameter('keyword', _i, '') as string;
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const additionalFields = this.getNodeParameter(
      'additionalFields',
      _i,
      {} as { cursor?: string; region?: string; days?: string },
    ) as { cursor?: string; region?: string; days?: string };

    // Defensive guards BEFORE the API call. The backend rejects each of
    // these with 400 VALIDATION_ERROR — fail fast with a clear UI message
    // instead of letting the workflow silently 400.
    if (!keyword || !keyword.trim()) {
      throw new NodeOperationError(this.getNode(), 'Keyword is required');
    }
    if (!platform) {
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    if (!VALID_PLATFORMS.includes(platform)) {
      throw new NodeOperationError(
        this.getNode(),
        `Platform must be one of: ${VALID_PLATFORMS.join(', ')}`,
      );
    }
    // Region is optional; if provided, must be a two-letter ISO 3166-1 code.
    // Empty string is the "user didn't pick one" sentinel — skip the check.
    if (additionalFields.region && !REGION_REGEX.test(additionalFields.region)) {
      throw new NodeOperationError(
        this.getNode(),
        'Region must be a two-letter ISO 3166-1 code (e.g. US, DE, JP)',
      );
    }
    // Days is optional; if provided, must be in the allow-list. Empty string
    // is the "user didn't pick one" sentinel — skip the check. Note that '0'
    // IS a valid forward (the "no time window" option).
    if (additionalFields.days && !VALID_DAYS.includes(additionalFields.days)) {
      throw new NodeOperationError(
        this.getNode(),
        `Days must be one of: ${VALID_DAYS.join(', ')}`,
      );
    }

    // Build the query-string explicitly — strip empty strings so the wire
    // request stays minimal. Mirrors the InfluticsVideo.getStats filter
    // pattern: only the keys the caller actually set go on the URL.
    const qs: IDataObject = {
      keyword: keyword.trim(),
      platform,
    };
    if (additionalFields.cursor) qs.cursor = additionalFields.cursor;
    if (additionalFields.region) qs.region = additionalFields.region;
    if (additionalFields.days) qs.days = additionalFields.days;

    const response = await influticsApiRequest.call(
      this,
      'GET',
      '/v1/trends/search',
      undefined,
      qs,
    );
    return response as IDataObject;
  },
};

export async function executeInfluticsTrend(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not yet implemented in InfluticsTrend node`,
    );
  }
  // Search is a single-batch op: one GET per workflow run regardless of
  // input item count. Mirrors the Track / Get Stats patterns.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class InfluticsTrend implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Trend',
    name: 'influticsTrend',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Search Influtics trends by keyword',
    defaults: { name: 'Influtics Trend' },
    inputs: ['main'],
    outputs: ['main'],
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
            name: 'Search',
            value: 'search',
            description: 'Search TikTok or YouTube trends by keyword',
            // eslint-disable-next-line n8n-nodes-base/node-param-operation-option-action-miscased
            action: 'Search TikTok or YouTube trends by keyword',
          },
        ],
        default: 'search',
      },
      // --- Search ---------------------------------------------------------
      {
        displayName: 'Keyword',
        name: 'keyword',
        // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
        type: 'string',
        displayOptions: { show: { operation: ['search'] } },
        default: '',
        required: true,
        description: 'Keyword to search trends for (will be trimmed before sending)',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['search'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'YouTube', value: 'youtube' },
        ],
        // The UI exposes both valid platforms; the backend rejects everything
        // else with 400 VALIDATION_ERROR. Default tiktok to match the rest of
        // the package's defaults (InfluticsVideo, InfluticsBlogger).
        default: 'tiktok',
        required: true,
        description: 'Platform to search trends on',
      },
      {
        displayName: 'Additional Options',
        name: 'additionalFields',
        type: 'collection',
        default: {},
        placeholder: 'Add Option',
        options: [
          {
            displayName: 'Cursor',
            name: 'cursor',
            type: 'string',
            default: '',
            description: 'Pagination cursor returned by a prior search call',
          },
          {
            displayName: 'Region',
            name: 'region',
            type: 'string',
            default: '',
            description: 'ISO 3166-1 alpha-2 country code (e.g. US, DE, JP)',
          },
          {
            displayName: 'Days',
            name: 'days',
            type: 'options',
            // Backend VALID_DAYS = [0, 1, 7, 30, 90, 180]. The empty option is
            // the "user didn't pick one" sentinel — the handler skips it so
            // the server applies its own default.
            options: [
              { name: 'No Window', value: '0' },
              { name: '1 Day', value: '1' },
              { name: '7 Days', value: '7' },
              { name: '30 Days', value: '30' },
              { name: '90 Days', value: '90' },
              { name: '180 Days', value: '180' },
            ],
            default: '0',
            description: 'Time window for the trend search (0 = no window)',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsTrend.call(this, this.getInputData());
  }
}