/**
 * Trend resource module for the Influtics single-action node.
 *
 * Source of truth: `nodes/InfluticsTrend/InfluticsTrend.node.ts`. The legacy
 * InfluticsTrend node remains registered until Phase 2 / Task 15, so the wire
 * contract MUST match 1:1 — any drift here breaks the migration-straddle
 * guarantee for users who still have legacy workflows open.
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
 *
 * The handler runs the same defensive guards the legacy node runs BEFORE the
 * HTTP call so the user sees a NodeOperationError in the n8n UI instead of a
 * raw 400 envelope. Empty string is treated as "user didn't pick one" for
 * every optional field; only truthy values are forwarded onto the wire.
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

// Backend hard allow-list (mirrors `VALID_PLATFORMS` / `VALID_DAYS` in
// api-worker/src/handlers/trendsHandler.js). The UI exposes these as
// dropdowns so the user can't pick anything else; this is defense-in-depth
// against custom callers / future schema drift.
const VALID_PLATFORMS = ['tiktok', 'youtube'];
const VALID_DAYS = ['0', '1', '7', '30', '90', '180'];
// ISO 3166-1 alpha-2 — two letters. Matches the server-side regex.
const REGION_REGEX = /^[A-Za-z]{2}$/;

export const TREND_OPERATIONS: Record<string, OperationHandler> = {
  // Search — single GET per workflow run. The executor calls the API
  // directly and returns the raw envelope so downstream n8n consumers see
  // exactly what the API sent (mirrors the Track / Get Stats patterns).
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

export function trendProperties(): INodeProperties[] {
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
          name: 'Search',
          value: 'search',
          description: 'Search TikTok or YouTube trends by keyword',
          action: 'Search tiktok or youtube trends by keyword',
        },
      ],
      default: 'search',
      // Scoped to resource=trend so the dropdown does not leak into
      // Account / Blogger / Video renders. The dispatcher spreads every
      // resource module's properties into the same INodeTypeDescription.
      displayOptions: { show: { resource: ['trend'] } },
    },
    // --- Search ----------------------------------------------------------
    {
      displayName: 'Keyword',
      name: 'keyword',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
      default: '',
      required: true,
      description: 'Keyword to search trends for (will be trimmed before sending)',
    },
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
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
      displayOptions: { show: { resource: ['trend'], operation: ['search'] } },
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
  ];
}
