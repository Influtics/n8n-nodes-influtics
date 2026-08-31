/**
 * Blogger resource module for the Influtics single-action node.
 *
 * Source of truth: `nodes/InfluticsBlogger/InfluticsBlogger.node.ts`. The
 * legacy InfluticsBlogger node remains registered until Phase 2 / Task 15,
 * so the wire contract MUST match 1:1 — any drift here breaks the migration-
 * straddle guarantee for users who still have legacy workflows open.
 *
 * Backend contract (verified against api-worker source):
 *   POST /v1/bloggers/track
 *     body (flat): { platform, username, initial_videos_count }
 *     - `initial_videos_count` is REQUIRED (integer in [1, 500]) per
 *       `validateTrackBloggerBody`. The UI clamps via `typeOptions.minValue`
 *       / `maxValue`; the executor clamps again for defense-in-depth
 *       against custom callers / future schema drift.
 *     - The platform-specific channel ID is NOT in the request. The
 *       consumer resolves `username -> channel_id` asynchronously via the
 *       platform API after dequeuing (see api-worker CLAUDE.md "Track
 *       creator flow").
 *     - 202 Accepted, returns
 *       `{ job_id, status_url, polling.retry_after_seconds }`.
 *     - Errors: 409 CREATOR_ALREADY_TRACKED, 422 SUBSCRIPTION_LIMIT,
 *       422 VALIDATION_ERROR, 402 PAID_PLAN_REQUIRED.
 *   GET /v1/bloggers/jobs/{job_id}
 *     - Path-only, no qs. Returns 200/404/410.
 *     - shapeJob uses `status` (queued|processing|succeeded|error), NOT
 *       `state`. 410 JOB_TIMEOUT when sweeper-marked (terminal — re-POST
 *       /v1/bloggers/track). 404 NOT_FOUND collapses "doesn't exist" +
 *       "wrong org" (Stripe-parity).
 *   GET /v1/bloggers/by-username/{username}?platform={platform}
 *     - Path is URL-decoded server-side (`decodeURIComponent`); executor
 *       URL-encodes the path segment so `@handle` (and other reserved
 *       chars) round-trip cleanly.
 *     - Query `platform` is optional; server defaults to `tiktok` if
 *       absent OR empty. We strip empty strings here so the wire request
 *       stays minimal and any future server-side default branch can't
 *       surprise us.
 *     - Read-only — NEVER auto-tracks. 404 BLOGGER_NOT_TRACKED if not
 *       tracked by the calling org. The legacy `/v1/bloggers/info?
 *       username=...` form was removed 2026-08-20 (see api-worker
 *       CLAUDE.md "Deprecations").
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

// Backend hard caps. Mirrors `validateTrackBloggerBody` in
// api-worker/src/handlers/lib/trackAccountValidator.js. The UI also
// clamps via `typeOptions.minValue` / `maxValue`; this is defense-in-
// depth for custom callers / future schema drift.
const INITIAL_VIDEOS_MIN = 1;
const INITIAL_VIDEOS_MAX = 500;

export const BLOGGER_OPERATIONS: Record<string, OperationHandler> = {
  // Track — single POST per workflow run (Track is single-batch, one
  // creator per workflow run regardless of input item count). The
  // executor clamps initial_videos_count defensively BEFORE the HTTP
  // call so the backend never sees an out-of-range integer.
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const username = this.getNodeParameter('username', _i, '') as string;
    const initialVideosCountRaw = this.getNodeParameter('initialVideosCount', _i, '');

    if (!platform) {
      // Fail fast: backend rejects missing platform (422 VALIDATION_ERROR).
      // Surface a clear UI message instead of letting the workflow
      // silently 422.
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    if (!username) {
      throw new NodeOperationError(this.getNode(), 'Username is required');
    }

    // Coerce + clamp initial_videos_count defensively:
    //   - blank string / non-number / NaN → fail fast
    //   - < 1 → fail fast (backend rejects, 422)
    //   - > 500 → clamp to 500 (backend rejects, 422; clamp defends
    //     against a custom caller bypassing the UI's maxValue guard)
    const initialVideosCount = Number(initialVideosCountRaw);
    if (
      initialVideosCountRaw === '' ||
      initialVideosCountRaw === null ||
      initialVideosCountRaw === undefined ||
      !Number.isFinite(initialVideosCount) ||
      !Number.isInteger(initialVideosCount)
    ) {
      throw new NodeOperationError(
        this.getNode(),
        'initial_videos_count is required and must be an integer between 1 and 500',
      );
    }
    const initialVideosCountClamped = Math.max(
      INITIAL_VIDEOS_MIN,
      Math.min(initialVideosCount, INITIAL_VIDEOS_MAX),
    );

    const response = await influticsApiRequest.call(
      this,
      'POST',
      '/v1/bloggers/track',
      {
        platform,
        username,
        initial_videos_count: initialVideosCountClamped,
      } as IDataObject,
    );
    return response as IDataObject;
  },

  // Get Job — single GET per workflow run. Path-only; backend reads
  // everything from the URL segment. Executor URL-encodes the jobId so
  // `@handle`, colons, and other reserved chars round-trip cleanly.
  getJob: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const jobId = this.getNodeParameter('jobId', _i, '') as string;
    if (!jobId) {
      // Fail fast: without an id we'd send `GET /v1/bloggers/jobs/`
      // which 404s with a confusing URL and no actionable error.
      throw new NodeOperationError(this.getNode(), 'Job ID is required');
    }
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/bloggers/jobs/${encodeURIComponent(jobId)}`,
    );
    return response as IDataObject;
  },

  // By Username — single GET per workflow run. Read-only — NEVER auto-
  // tracks. Path is URL-encoded; qs carries `platform` ONLY when
  // truthy (empty string stripped so the server's `|| 'tiktok'`
  // default branch applies cleanly).
  byUsername: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const username = this.getNodeParameter('username', _i, '') as string;
    if (!username) {
      // Without a username the URL would be `/v1/bloggers/by-username/`
      // — backend returns 400 VALIDATION_ERROR. Fail fast with a clear
      // UI message instead.
      throw new NodeOperationError(this.getNode(), 'Username is required');
    }
    // Backend reads `url.searchParams.get('platform') || 'tiktok'`.
    // Empty string would technically still resolve to 'tiktok' server-
    // side, but we strip it anyway so the wire request stays minimal
    // and any future server-side change to the default branch can't
    // surprise us.
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const qs: IDataObject = {};
    if (platform) qs.platform = platform;

    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/bloggers/by-username/${encodeURIComponent(username)}`,
      undefined,
      Object.keys(qs).length > 0 ? qs : undefined,
    );
    return response as IDataObject;
  },
};

export function bloggerProperties(): INodeProperties[] {
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
          name: 'By Username',
          value: 'byUsername',
          description: 'Read a tracked creator by platform + username (read-only)',
          action: 'Read a tracked creator by platform + username',
        },
        {
          name: 'Get Job',
          value: 'getJob',
          description: 'Poll the status of a track-creator job by ID',
          action: 'Poll the status of a track creator job by id',
        },
        {
          name: 'Track',
          value: 'track',
          description: 'Start tracking a creator (async — returns job_id to poll)',
          action: 'Start tracking a creator',
        },
      ],
      default: 'track',
      // Scoped to resource=blogger so the dropdown does not leak into
      // Account / Trend / Video renders. The dispatcher spreads every
      // resource module's properties into the same INodeTypeDescription.
      displayOptions: { show: { resource: ['blogger'] } },
    },
    // --- Track ----------------------------------------------------------
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' },
        { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' },
        { name: 'VK', value: 'vk' },
      ],
      default: 'tiktok',
      required: true,
      description: 'Platform to track the creator on',
    },
    {
      displayName: 'Username',
      name: 'username',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      default: '',
      required: true,
      description: 'Creator username without the leading @ (max 64 chars)',
    },
    {
      displayName: 'Initial Videos Count',
      name: 'initialVideosCount',
      type: 'number',
      displayOptions: { show: { resource: ['blogger'], operation: ['track'] } },
      // Backend (validateTrackBloggerBody) requires an integer in [1, 500].
      // The UI clamps via minValue/maxValue; the executor clamps again for
      // defense-in-depth against custom callers.
      typeOptions: { minValue: 1, maxValue: 500 },
      default: 10,
      required: true,
      description:
        'Number of initial videos to backfill (1–500). Default: 10. Backend clamps to 500.',
    },
    // --- Get Job -------------------------------------------------------
    {
      displayName: 'Job ID',
      name: 'jobId',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['getJob'] } },
      default: '',
      required: true,
      description: 'Job UUID returned by the Track operation',
    },
    // --- By Username ---------------------------------------------------
    {
      displayName: 'Username',
      name: 'username',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['blogger'], operation: ['byUsername'] } },
      default: '',
      required: true,
      description: 'Creator username (with or without leading @)',
    },
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: { show: { resource: ['blogger'], operation: ['byUsername'] } },
      options: [
        { name: 'TikTok', value: 'tiktok' },
        { name: 'Instagram', value: 'instagram' },
        { name: 'YouTube', value: 'youtube' },
        { name: 'VK', value: 'vk' },
      ],
      // The backend defaults to `tiktok` when `platform` is absent or
      // empty. Defaulting the UI to the same value keeps wire requests
      // clean and matches what users would otherwise type.
      default: 'tiktok',
      required: true,
      description: 'Platform the creator is on (defaults to tiktok server-side)',
    },
  ];
}
