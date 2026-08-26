/**
 * Influtics Blogger node.
 *
 * Implementation choices:
 * - File lives at nodes/InfluticsBlogger/InfluticsBlogger.node.ts — required by the
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention` rule.
 * - `executeInfluticsBlogger` is also exported as a named function so unit tests
 *   can drive the executor without instantiating the INodeType class.
 * - Tasks 4/5/6 ship the InfluticsVideo node; this node (Task 7) adds the
 *   blogger side: Track + Get Job + By Username.
 * - The unimplemented-operation branch keeps the executor safe if a future
 *   version's parameters somehow leak an unknown value.
 *
 * Backend contract (verified against api-worker source):
 *   POST /v1/bloggers/track
 *     body (flat): { platform, username, initial_videos_count }
 *     - `initial_videos_count` is REQUIRED (integer in [1, 500])
 *       per validateTrackBloggerBody — the stale `track.md` docs page and
 *       the plan both omit it; the validator rejects bodies without it.
 *     - The platform-specific channel ID is NOT in the request. The consumer
 *       resolves `username -> channel_id` asynchronously via the platform
 *       API after dequeuing (see api-worker CLAUDE.md "Track creator flow").
 *     - 202 Accepted, returns `{ job_id, status_url, polling.retry_after_seconds }`.
 *     - 409 CREATOR_ALREADY_TRACKED, 422 SUBSCRIPTION_LIMIT, 402 PAID_PLAN_REQUIRED.
 *   GET /v1/bloggers/jobs/{job_id}
 *     - Path-only, no qs. Returns 200/404/410.
 *     - shapeJob uses `status` (queued|processing|succeeded|error), not `state`.
 *     - 410 JOB_TIMEOUT when sweeper-marked (terminal — re-POST /v1/bloggers/track).
 *     - 404 NOT_FOUND collapses "doesn't exist" + "wrong org" (Stripe-parity).
 *   GET /v1/bloggers/by-username/{username}?platform={platform}
 *     - Path is URL-decoded server-side (`decodeURIComponent`); executor
 *       URL-encodes the path segment so `@handle` (and other reserved chars)
 *       round-trip cleanly.
 *     - Query `platform` is optional; server defaults to `tiktok` if absent
 *       OR empty. We strip empty strings here so the default path stays clean.
 *     - Read-only — NEVER auto-tracks. 404 BLOGGER_NOT_TRACKED if not tracked
 *       by the calling org. The legacy /v1/bloggers/info?username=... form
 *       was removed 2026-08-20 (see api-worker CLAUDE.md "Deprecations").
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from '../GenericFunctions.js';

// Per-operation handler map. Track is a single batch op; one call per workflow
// run regardless of input item count. By Username / Get Job are also single-
// batch (one creator per workflow run, mirrors Track videos).
type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

// Backend hard caps. Mirrors `validateTrackBloggerBody` in
// api-worker/src/handlers/lib/trackAccountValidator.js. The UI also clamps
// via `typeOptions.minValue` / `maxValue`; this is defense-in-depth for
// custom callers / future schema drift.
const INITIAL_VIDEOS_MIN = 1;
const INITIAL_VIDEOS_MAX = 500;

const OPERATIONS: Record<string, OperationHandler> = {
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const platform = this.getNodeParameter('platform', _i, '') as string;
    const username = this.getNodeParameter('username', _i, '') as string;
    const initialVideosCountRaw = this.getNodeParameter('initialVideosCount', _i, '');

    if (!platform) {
      // Fail fast: backend rejects missing platform (422 VALIDATION_ERROR).
      // Surface a clear UI message instead of letting the workflow silently 422.
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    if (!username) {
      throw new NodeOperationError(this.getNode(), 'Username is required');
    }

    // Coerce + clamp initial_videos_count defensively:
    //   - blank string / non-number / NaN → fail fast
    //   - < 1 → fail fast (backend rejects, 422)
    //   - > 500 → clamp to 500 (backend rejects, 422; clamp defends against
    //     a custom caller bypassing the UI's maxValue guard)
    // The UI's `typeOptions.minValue = 1 / maxValue = 500` is the primary
    // guard; this is the second line of defense.
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
  getJob: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const jobId = this.getNodeParameter('jobId', _i, '') as string;
    if (!jobId) {
      // Fail fast: without an id we'd send `GET /v1/bloggers/jobs/` which 404s
      // with a confusing URL and no actionable error.
      throw new NodeOperationError(this.getNode(), 'Job ID is required');
    }
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/bloggers/jobs/${encodeURIComponent(jobId)}`,
    );
    return response as IDataObject;
  },
  byUsername: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const username = this.getNodeParameter('username', _i, '') as string;
    if (!username) {
      // Without a username the URL would be /v1/bloggers/by-username/ — backend
      // returns 400 VALIDATION_ERROR. Fail fast with a clear UI message instead.
      throw new NodeOperationError(this.getNode(), 'Username is required');
    }
    // Backend reads `url.searchParams.get('platform') || 'tiktok'`. Empty string
    // would technically still resolve to 'tiktok' server-side, but we strip it
    // anyway so the wire request stays minimal and any future server-side
    // change to the default branch can't surprise us.
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

export async function executeInfluticsBlogger(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not yet implemented in InfluticsBlogger node`,
    );
  }
  // All three ops are single-batch (one creator per workflow run regardless of
  // input item count). Mirrors the Track videos pattern from InfluticsVideo.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class InfluticsBlogger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Blogger',
    name: 'influticsBlogger',
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Track and read Influtics bloggers (creators)',
    defaults: { name: 'Influtics Blogger' },
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
      },
      // --- Track ---------------------------------------------------------
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['track'] } },
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
        type: 'string',
        displayOptions: { show: { operation: ['track'] } },
        default: '',
        required: true,
        description: 'Creator username without the leading @ (max 64 chars)',
      },
      {
        displayName: 'Initial Videos Count',
        name: 'initialVideosCount',
        type: 'number',
        displayOptions: { show: { operation: ['track'] } },
        // Backend (validateTrackBloggerBody) requires an integer in [1, 500].
        // The UI clamps via minValue/maxValue; the executor clamps again
        // for defense-in-depth against custom callers.
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
        type: 'string',
        displayOptions: { show: { operation: ['getJob'] } },
        default: '',
        required: true,
        description: 'Job UUID returned by the Track operation',
      },
      // --- By Username ---------------------------------------------------
      {
        displayName: 'Username',
        name: 'username',
        type: 'string',
        displayOptions: { show: { operation: ['byUsername'] } },
        default: '',
        required: true,
        description: 'Creator username (with or without leading @)',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['byUsername'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'VK', value: 'vk' },
        ],
        // The backend defaults to `tiktok` when `platform` is absent or empty.
        // Defaulting the UI to the same value keeps wire requests clean and
        // matches what users would otherwise type.
        default: 'tiktok',
        required: true,
        description: 'Platform the creator is on (defaults to tiktok server-side)',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsBlogger.call(this, this.getInputData());
  }
}
