/**
 * Influtics Video node.
 *
 * Implementation choices:
 * - File lives at nodes/InfluticsVideo/InfluticsVideo.node.ts — required by the
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention` rule.
 * - `executeInfluticsVideo` is also exported as a named function so unit tests
 *   can drive the executor without instantiating the INodeType class.
 * - Tasks 4/5/6 ship Track + Get Stats + Get/Update by ID/External ID.
 * - The unimplemented-operation branch keeps the executor safe if a future
 *   version's parameters somehow leak an unknown value.
 */
import {
  NodeConnectionTypes,
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from '../GenericFunctions';

// Per-operation handler map. Track is a single batch op; one call per workflow
// run regardless of input item count. Future operations (Tasks 6/7) add a key
// + tests here without growing the executor's else-if chain.
type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

// Hard cap on paginated pages for `returnAll` to keep a runaway cursor from
// DOSing the workflow. Each page is `limit` items (≤ 100) so 50 pages = 5000
// items worst case — comfortably above the 1000-row PostgREST cap.
const PAGINATION_MAX_PAGES = 50;

const OPERATIONS: Record<string, OperationHandler> = {
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const urlsParam = this.getNodeParameter('urls', _i) as { urls: string[] };
    if (!Array.isArray(urlsParam.urls) || urlsParam.urls.length === 0) {
      throw new NodeOperationError(this.getNode(), 'Provide at least one video URL');
    }
    const response = await influticsApiRequest.call(
      this,
      'POST',
      '/v1/videos/track',
      { urls: urlsParam.urls } as IDataObject,
    );
    return response as IDataObject;
  },
  getStats: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    // Build the filter object only from values the caller actually set, so an
    // unfiltered query goes out as `?` with no params (and the API applies its
    // own server-side defaults). Empty string → omit.
    //
    // The real `/v1/videos/stats` endpoint (see api-worker `handleGetVideoStats`)
    // accepts ONLY these query params: `limit`, `offset`, `platform` (single),
    // `status` (single), `blogger_username` (single), `sort`, `order`. The UI
    // mirrors that set exactly — campaign / search / published_from / etc. are
    // not part of the contract and would silently be ignored, so they are not
    // exposed.
    const platform = this.getNodeParameter('platform', i, '') as string;
    const status = this.getNodeParameter('status', i, '') as string;
    const bloggerUsername = this.getNodeParameter('blogger_username', i, '') as string;
    const sort = this.getNodeParameter('sort', i, '') as string;
    const order = this.getNodeParameter('order', i, '') as string;
    const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
    // `limit` is only meaningful when `returnAll` is false; the `returnAll`
    // paginator walks `has_more` and owns the page count, so a limit there would
    // just be ignored (or worse, fight the page walk). The UI hides this field
    // under the same `returnAll: [false]` guard so callers won't set it for the
    // `returnAll` branch, but we still gate here for safety.
    const limitRaw = this.getNodeParameter('limit', i, 50) as unknown;
    const limitRawNum = typeof limitRaw === 'number' && limitRaw > 0 ? limitRaw : 50;
    // The API hard-caps `limit` at 100. The UI also clamps via
    // `typeOptions.maxValue = 100`, but a custom caller or a future schema
    // regression could still pass >100 here — coerce defensively so we never
    // send a value the server will silently truncate.
    const limit = Math.min(limitRawNum, 100);

    const baseQs: IDataObject = {};
    if (platform) baseQs.platform = platform;
    if (status) baseQs.status = status;
    if (bloggerUsername) baseQs.blogger_username = bloggerUsername;
    if (sort) baseQs.sort = sort;
    if (order) baseQs.order = order;
    if (!returnAll) baseQs.limit = limit;

    // The cursor-aware `influticsApiRequestAllItems` helper reads
    // `meta.next_cursor`, which the real `/v1/videos/stats` endpoint never
    // returns — it paginates via `offset` + a `has_more` boolean on
    // `data.pagination`. Inline the walk here so we honour the actual contract.
    if (returnAll) {
      const collected: IDataObject[] = [];
      const pageSize = typeof limit === 'number' && limit > 0 ? limit : 50;
      let offset = 0;
      for (let page = 0; page < PAGINATION_MAX_PAGES; page++) {
        const pageQs: IDataObject = { ...baseQs, limit: pageSize, offset };
        const response = await influticsApiRequest.call(
          this,
          'GET',
          '/v1/videos/stats',
          undefined,
          pageQs,
        );
        // Items live at response.data.data; the success envelope puts the
        // payload under `data` and the API wraps its array under another
        // `data` key. Be tolerant: if the API ever drops the inner wrapper,
        // accept `data` as the array directly.
        const items: unknown[] = Array.isArray((response as any)?.data?.data)
          ? ((response as any).data.data as unknown[])
          : Array.isArray((response as any)?.data)
            ? ((response as any).data as unknown[])
            : [];
        for (const item of items) {
          if (item && typeof item === 'object') {
            collected.push(item as IDataObject);
          }
        }
        const pagination = (response as any)?.data?.pagination;
        const hasMore = !!pagination?.has_more;
        if (!hasMore) break;
        offset += pageSize;
      }
      // Track returns the raw envelope; mirror that here so the downstream
      // n8n consumer sees the same shape from both batch ops.
      return { data: collected } as IDataObject;
    }

    return (await influticsApiRequest.call(
      this,
      'GET',
      '/v1/videos/stats',
      undefined,
      baseQs,
    )) as IDataObject;
  },
  // --- Task 6: single-resource lookups + patch -------------------------------
  // Backend contract (see api-worker handlers in index.js):
  //   GET    /v1/videos/by-id/{id}
  //   GET    /v1/videos/by-external-id/{externalId}
  //   PATCH  /v1/videos/by-external-id/{externalId}
  //     body: at least one of notes, budget, campaign, video_status, status, tags
  //   None of these read query params — the (organization_id, external_video_id)
  //   partial unique index scopes the row, so platform on the wire is cruft.
  //   The UI keeps the `platform` dropdown as a user-facing hint (it's marked
  //   `required: true` for `getByExternalId` / `updateByExternalId`), but the
  //   executor does not forward it.
  getById: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const id = this.getNodeParameter('id', i, '') as string;
    if (!id) {
      // Fail fast: without an id we'd send `GET /v1/videos/by-id/` which 404s
      // with a confusing URL and no actionable error.
      throw new NodeOperationError(this.getNode(), 'Video ID is required');
    }
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/videos/by-id/${encodeURIComponent(id)}`,
    );
    return response as IDataObject;
  },
  getByExternalId: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const externalId = this.getNodeParameter('externalId', i, '') as string;
    if (!externalId) {
      throw new NodeOperationError(this.getNode(), 'External ID is required');
    }
    // Defensive: backend ignores platform, but UI marks it `required: true`.
    // A workflow that somehow arrived here with an empty platform is broken
    // — fail loudly instead of silently sending a request the backend ignores.
    const platform = this.getNodeParameter('platform', i, '') as string;
    if (!platform) {
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`,
    );
    return response as IDataObject;
  },
  updateByExternalId: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const externalId = this.getNodeParameter('externalId', i, '') as string;
    if (!externalId) {
      throw new NodeOperationError(this.getNode(), 'External ID is required');
    }
    const platform = this.getNodeParameter('platform', i, '') as string;
    if (!platform) {
      throw new NodeOperationError(this.getNode(), 'Platform is required');
    }
    const updateFields = this.getNodeParameter(
      'updateFields',
      i,
      {} as { notes?: string; campaign?: string; status?: string; tags?: string[] },
    ) as { notes?: string; campaign?: string; status?: string; tags?: string[] };

    // Backend (handlePatchVideoByExternalId) accepts any of: notes, budget,
    // campaign, video_status, status, tags. The UI exposes a subset (notes,
    // campaign, status, tags). Coerce defensively:
    //   - string fields: include only when non-empty (so we never send
    //     `campaign: ""` which the backend would silently drop and mask intent)
    //   - tags: include only when it's a non-empty array
    // An empty body would 400 server-side; surface that here as a clear
    // NodeOperationError instead.
    const body: IDataObject = {};
    if (typeof updateFields.notes === 'string' && updateFields.notes.length > 0) {
      body.notes = updateFields.notes;
    }
    if (typeof updateFields.campaign === 'string' && updateFields.campaign.length > 0) {
      body.campaign = updateFields.campaign;
    }
    if (typeof updateFields.status === 'string' && updateFields.status.length > 0) {
      body.status = updateFields.status;
    }
    if (Array.isArray(updateFields.tags) && updateFields.tags.length > 0) {
      body.tags = updateFields.tags;
    }
    if (Object.keys(body).length === 0) {
      throw new NodeOperationError(
        this.getNode(),
        'Provide at least one update field (notes, campaign, status, or tags)',
      );
    }

    const response = await influticsApiRequest.call(
      this,
      'PATCH',
      `/v1/videos/by-external-id/${encodeURIComponent(externalId)}`,
      body,
    );
    return response as IDataObject;
  },
};

export async function executeInfluticsVideo(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not yet implemented in InfluticsVideo node`,
    );
  }
  // Track is a single batch op; one call per workflow run regardless of input item count.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class InfluticsVideo implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics Video',
    name: 'influticsVideo',
    icon: { light: 'file:influtics-light.svg', dark: 'file:influtics-dark.svg' },
    group: ['transform'],
    version: 1,
    subtitle: '={{ $parameter["operation"] }}',
    description: 'Track and read Influtics videos',
    defaults: { name: 'Influtics Video' },
    // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node -- scanner `@n8n/community-nodes/node-connection-type-literal` requires the enum; the local plugin (1.16.0) wants the literal and is stale against newer n8n-workflow APIs.
    inputs: [NodeConnectionTypes.Main],
    // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong -- scanner requires the enum (see inputs comment above); satisfying it is what blocks v1.0.9 ship.
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          {
            name: 'Get By External ID',
            value: 'getByExternalId',
            description: 'Read one tracked video by platform + external ID',
            action: 'Read one tracked video by platform + external ID',
          },
          {
            name: 'Get By ID',
            value: 'getById',
            description: 'Read one tracked video by internal ID',
            action: 'Read one tracked video by internal ID',
          },
          {
            name: 'Get Stats',
            value: 'getStats',
            description: 'Read video-level metrics',
            action: 'Read video level metrics',
          },
          {
            name: 'Track',
            value: 'track',
            description: 'Track videos by URL',
            action: 'Track videos by URL',
          },
          {
            name: 'Update By External ID',
            value: 'updateByExternalId',
            description: 'Patch metadata on a tracked video',
            action: 'Patch metadata on a tracked video',
          },
        ],
        default: 'track',
      },
      // --- Track --------------------------------------------------------------
      {
        displayName: 'URLs',
        name: 'urls',
        type: 'collection',
        displayOptions: { show: { operation: ['track'] } },
        default: {},
        options: [
          {
            displayName: 'URLs',
            name: 'urls',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Up to 50 video URLs to track',
          },
        ],
      },
      // --- Get Stats ----------------------------------------------------------
      {
        displayName: 'Return All',
        name: 'returnAll',
        type: 'boolean',
        displayOptions: { show: { operation: ['getStats'] } },
        default: false,
        description: 'Whether to return all results or only up to a given limit',
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        displayOptions: { show: { operation: ['getStats'], returnAll: [false] } },
        // The API hard-caps `limit` at 100. The handler defensively clamps via
        // Math.min(limit, 100) so the value can never be >100 on the wire,
        // even if a custom caller bypasses the UI's `minValue` guard.
        typeOptions: { minValue: 1 },
        default: 50,
        description: 'Max number of results to return',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['getStats'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'VK', value: 'vk' },
        ],
        default: 'tiktok',
        description: 'Filter by a single platform',
      },
      {
        displayName: 'Status',
        name: 'status',
        type: 'options',
        displayOptions: { show: { operation: ['getStats'] } },
        options: [
          { name: 'Active', value: 'active' },
          { name: 'Completed', value: 'completed' },
          { name: 'Failed', value: 'failed' },
        ],
        default: 'active',
        description: 'Filter by tracking status',
      },
      {
        displayName: 'Blogger Username',
        name: 'blogger_username',
        type: 'string',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
        description: 'Filter by a single blogger username',
      },
      {
        displayName: 'Sort',
        name: 'sort',
        type: 'string',
        displayOptions: { show: { operation: ['getStats'] } },
        default: 'created_at',
        description:
          'Field to sort by. Allowed: created_at, views, likes, updated_at. Default: created_at',
      },
      {
        displayName: 'Order',
        name: 'order',
        type: 'options',
        displayOptions: { show: { operation: ['getStats'] } },
        options: [
          { name: 'Ascending', value: 'asc' },
          { name: 'Descending', value: 'desc' },
        ],
        default: 'desc',
        description: 'Sort order',
      },
      // --- Get By ID ----------------------------------------------------------
      {
        displayName: 'Video ID',
        name: 'id',
        type: 'string',
        displayOptions: { show: { operation: ['getById'] } },
        default: '',
        required: true,
      },
      // --- Get By External ID / Update By External ID ------------------------
      {
        displayName: 'External ID',
        name: 'externalId',
        type: 'string',
        displayOptions: { show: { operation: ['getByExternalId', 'updateByExternalId'] } },
        default: '',
        required: true,
        description: 'The platform-specific video ID (e.g. TikTok video ID)',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        displayOptions: { show: { operation: ['getByExternalId', 'updateByExternalId'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'VK', value: 'vk' },
        ],
        default: 'tiktok',
        required: true,
      },
      // --- Update By External ID body fields ---------------------------------
      {
        displayName: 'Update Fields',
        name: 'updateFields',
        type: 'collection',
        displayOptions: { show: { operation: ['updateByExternalId'] } },
        default: {},
        options: [
          { displayName: 'Notes', name: 'notes', type: 'string', default: '' },
          { displayName: 'Campaign', name: 'campaign', type: 'string', default: '' },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            options: [
              // Sentinel: empty value means "no change" so untouched status
              // doesn't clobber existing workflow state. The handler drops
              // empty strings from the body.
              { name: 'No Change', value: '' },
              { name: 'To Do', value: 'to do' },
              { name: 'Running', value: 'running' },
              { name: 'Ended', value: 'ended' },
            ],
            default: '',
          },
          {
            displayName: 'Tags',
            name: 'tags',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Tag names to attach (existing tags are preserved)',
          },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsVideo.call(this, this.getInputData());
  }
}
