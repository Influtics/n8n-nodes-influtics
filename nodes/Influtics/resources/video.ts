/**
 * Video resource module for the Influtics single-action node.
 *
 * Source of truth: `nodes/InfluticsVideo/InfluticsVideo.node.ts`. The legacy
 * InfluticsVideo node remains registered until Phase 2 / Task 15, so the
 * wire contract MUST match 1:1 — any drift here breaks the migration-straddle
 * guarantee for users who still have legacy workflows open.
 *
 * Backend contract (verified against api-worker handlers):
 *   POST /v1/videos/track
 *     body: { urls: string[] } (1 ≤ urls.length ≤ 50)
 *     - 202 Accepted. Returns the per-URL status envelope
 *       `{ data: { tracked: [{ url, status }, ...] } }`.
 *     - Empty `urls` → 400 VALIDATION_ERROR. Guard before HTTP call.
 *   GET /v1/videos/stats
 *     qs (all optional): limit (≤100), offset, platform (single), status
 *     (single), blogger_username (single), sort, order.
 *     - Paginates via `offset` + `data.pagination.has_more`, NOT via
 *       `meta.next_cursor` (so the generic
 *       `influticsApiRequestAllItems` helper is unsuitable — the cursor
 *       walk is inlined here).
 *     - On `returnAll: true`, the executor folds every page's items into
 *       a single `{ data: [...] }` envelope.
 *     - Items live at `response.data.data`; the legacy executor falls
 *       back to `response.data` directly when the API ever drops the
 *       inner wrapper.
 *   GET /v1/videos/by-id/{id}
 *     - Path-only, no qs. URL-encoded id so reserved chars
 *       (e.g. `vid:1`) round-trip cleanly.
 *     - Empty id → 404 from backend. Guard before HTTP call.
 *   GET /v1/videos/by-external-id/{externalId}
 *     - Path-only, no qs. The (organization_id, external_video_id)
 *       partial unique index scopes the row, so the `platform` field the
 *       UI marks required is NOT sent on the wire (backend ignores it).
 *     - Empty externalId OR empty platform → guard before HTTP call. The
 *       platform guard is defensive — the backend ignores it — but the UI
 *       requires it and a workflow that arrived here with an empty
 *       platform is broken.
 *   PATCH /v1/videos/by-external-id/{externalId}
 *     body (each field optional, at least one must be present):
 *       notes?, campaign?, status?, tags? (string[]).
 *     - Empty body → 400 VALIDATION_ERROR. Guard before HTTP call.
 *     - Backend silently drops empty string fields, but the executor
 *       strips them here so the wire always expresses caller intent and
 *       an empty body fails fast with a clear UI message instead of a
 *       confusing 400.
 *
 * Each handler is a thin wrapper around `influticsApiRequest`. The
 * dispatcher (Influtics.node.ts) routes via
 * `OPERATIONS[resource][operation]`, looking up this map by operation.
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeProperties,
} from 'n8n-workflow';
import { influticsApiRequest } from '../../GenericFunctions';
import type { OperationHandler } from '../Influtics.node';

/**
 * Hard cap on paginated pages for `returnAll: true` to keep a runaway
 * cursor from DOSing the workflow. Each page is `limit` items (≤ 100), so
 * 50 pages = 5000 items worst case — comfortably above the 1000-row
 * PostgREST cap. Mirrors the legacy InfluticsVideo executor.
 */
const PAGINATION_MAX_PAGES = 50;

/**
 * Defensive `limit` clamping for getStats. Mirrors the legacy handler:
 *   - any value that isn't a positive finite number (including '' / 0 /
 *     negative / non-numeric) → 50 (server default)
 *   - any value > 100 → 100 (backend hard cap)
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const VIDEO_OPERATIONS: Record<string, OperationHandler> = {
  // --- track ---------------------------------------------------------------
  // Single POST per workflow run. Track is single-batch: one call per
  // workflow run regardless of input item count. The URLs are submitted
  // in a single batch (≤ 50 per request per the `Track videos` UI).
  track: async function (this: IExecuteFunctions, _i: number): Promise<IDataObject> {
    const urlsParam = this.getNodeParameter(
      'urls',
      _i,
      { urls: [] } as { urls: string[] },
    ) as { urls: string[] };
    // Fail fast: an empty urls array would 400 server-side with a
    // confusing envelope; surface a clear UI message BEFORE the HTTP call.
    if (!Array.isArray(urlsParam.urls) || urlsParam.urls.length === 0) {
      throw new NodeOperationError(
        this.getNode(),
        'Provide at least one video URL',
      );
    }
    const response = await influticsApiRequest.call(
      this,
      'POST',
      '/v1/videos/track',
      { urls: urlsParam.urls } as IDataObject,
    );
    return response as IDataObject;
  },

  // --- getStats ------------------------------------------------------------
  // Two modes: `returnAll: false` → single GET (one page, capped at
  // `limit` items); `returnAll: true` → inline paginator that walks
  // `data.pagination.has_more` (NOT `meta.next_cursor`, which `/v1/videos/
  // stats` never returns).
  getStats: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    // Build the filter object only from values the caller actually set, so
    // an unfiltered query goes out as `?` with no params (and the API
    // applies its own server-side defaults). Empty string → omit.
    const platform = this.getNodeParameter('platform', i, '') as string;
    const status = this.getNodeParameter('status', i, '') as string;
    const bloggerUsername = this.getNodeParameter('blogger_username', i, '') as string;
    const sort = this.getNodeParameter('sort', i, '') as string;
    const order = this.getNodeParameter('order', i, '') as string;
    const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;

    // Defensive clamping — see DEFAULT_LIMIT / MAX_LIMIT docs.
    const limitRaw = this.getNodeParameter('limit', i, DEFAULT_LIMIT) as unknown;
    const limitRawNum =
      typeof limitRaw === 'number' && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT;
    const limit = Math.min(limitRawNum, MAX_LIMIT);

    // Common filter object shared across the paginator's first call.
    // `limit` is added at the end so `returnAll: false` still sends it,
    // but the paginator below adds its own `limit` per page.
    const baseQs: IDataObject = {};
    if (platform) baseQs.platform = platform;
    if (status) baseQs.status = status;
    if (bloggerUsername) baseQs.blogger_username = bloggerUsername;
    if (sort) baseQs.sort = sort;
    if (order) baseQs.order = order;
    if (!returnAll) baseQs.limit = limit;

    if (returnAll) {
      // Inline cursor-aware walk. The generic
      // `influticsApiRequestAllItems` reads `meta.next_cursor`, which
      // /v1/videos/stats never returns — so we honour the actual contract
      // here. Mirrors the legacy InfluticsVideo executor.
      const collected: IDataObject[] = [];
      // Use the (defensively-clamped) limit as the page size so a user
      // who typed 25 in the UI still walks pages of 25 items. The
      // fallback to DEFAULT_LIMIT mirrors the `limit` defensive clamp.
      const pageSize = limit > 0 ? limit : DEFAULT_LIMIT;
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
        // Items live at `response.data.data`; tolerate a missing inner
        // wrapper by accepting `response.data` as the array directly.
        // Future-proofing for an API revision that drops the wrapper.
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
      // n8n consumer sees a stable `{ data: [...] }` shape regardless of
      // which path the server took (cursor vs single-page).
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

  // --- getById -------------------------------------------------------------
  // Single GET per workflow run. Path-only; backend reads the id from
  // the URL segment. URL-encodes the id so reserved chars round-trip.
  getById: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const id = this.getNodeParameter('id', i, '') as string;
    if (!id) {
      // Fail fast: without an id the URL would be
      // `/v1/videos/by-id/` which 404s with a confusing URL and no
      // actionable error.
      throw new NodeOperationError(this.getNode(), 'Video ID is required');
    }
    const response = await influticsApiRequest.call(
      this,
      'GET',
      `/v1/videos/by-id/${encodeURIComponent(id)}`,
    );
    return response as IDataObject;
  },

  // --- getByExternalId -----------------------------------------------------
  // Single GET per workflow run. Read-only: the (organization_id,
  // external_video_id) partial unique index scopes the row; `platform`
  // is NOT forwarded (the UI marks it required, but the backend would
  // ignore it).
  getByExternalId: async function (this: IExecuteFunctions, i: number): Promise<IDataObject> {
    const externalId = this.getNodeParameter('externalId', i, '') as string;
    if (!externalId) {
      throw new NodeOperationError(this.getNode(), 'External ID is required');
    }
    // Defensive guard. Backend ignores `platform`, but UI marks it
    // `required: true`. A workflow that arrived here with an empty
    // platform is broken — fail loudly instead of silently sending a
    // request the backend ignores.
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

  // --- updateByExternalId --------------------------------------------------
  // Single PATCH per workflow run. Partial update — only forward the
  // fields the caller actually set, so an empty body fails fast with a
  // clear UI message instead of a 400 envelope.
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
      {} as {
        notes?: string;
        campaign?: string;
        status?: string;
        tags?: string[];
      },
    ) as {
      notes?: string;
      campaign?: string;
      status?: string;
      tags?: string[];
    };

    // Coerce defensively so an empty body never reaches the wire:
    //   - string fields: include only when non-empty (the backend would
    //     silently drop `notes: ""`, masking caller intent)
    //   - tags: include only when it's a non-empty array
    // An empty body would 400 server-side; surface that here as a
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

export function videoProperties(): INodeProperties[] {
  return [
    // --- Operation ---------------------------------------------------------
    {
      displayName: 'Operation',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      // Alphabetized per eslint-plugin-n8n-nodes-base
      // `node-param-options-type-unsorted-items`. Each option carries an
      // `action:` (rule `node-param-operation-option-action-miscased`).
      // Scoped to resource=video so the dropdown does not leak into
      // Account / Blogger / Trend renders (the dispatcher spreads every
      // resource module's properties into the same INodeTypeDescription).
      displayOptions: { show: { resource: ['video'] } },
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
      displayOptions: { show: { resource: ['video'], operation: ['track'] } },
      default: {},
      options: [
        {
          displayName: 'URLs',
          name: 'urls',
          // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
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
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: false,
      description: 'Whether to return all results or only up to a given limit',
    },
    {
      displayName: 'Limit',
      name: 'limit',
      type: 'number',
      displayOptions: {
        show: { resource: ['video'], operation: ['getStats'], returnAll: [false] },
      },
      // API hard-caps at 100. The UI does not expose maxValue (the
      // executor clamps defensively against custom callers / future
      // schema drift; see `MAX_LIMIT` in resources/video.ts).
      typeOptions: { minValue: 1 },
      default: 50,
      description: 'Max number of results to return',
    },
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
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
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
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
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: '',
      description: 'Filter by a single blogger username',
    },
    {
      displayName: 'Sort',
      name: 'sort',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
      default: 'created_at',
      description:
        'Field to sort by. Allowed: created_at, views, likes, updated_at. Default: created_at',
    },
    {
      displayName: 'Order',
      name: 'order',
      type: 'options',
      displayOptions: { show: { resource: ['video'], operation: ['getStats'] } },
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
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: { show: { resource: ['video'], operation: ['getById'] } },
      default: '',
      required: true,
    },
    // --- Get By External ID / Update By External ID ------------------------
    {
      displayName: 'External ID',
      name: 'externalId',
      // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
      type: 'string',
      displayOptions: {
        show: {
          resource: ['video'],
          operation: ['getByExternalId', 'updateByExternalId'],
        },
      },
      default: '',
      required: true,
      description: 'The platform-specific video ID (e.g. TikTok video ID)',
    },
    {
      displayName: 'Platform',
      name: 'platform',
      type: 'options',
      displayOptions: {
        show: {
          resource: ['video'],
          operation: ['getByExternalId', 'updateByExternalId'],
        },
      },
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
      displayOptions: {
        show: { resource: ['video'], operation: ['updateByExternalId'] },
      },
      default: {},
      options: [
        {
          displayName: 'Notes',
          name: 'notes',
          // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
          type: 'string',
          default: '',
        },
        {
          displayName: 'Campaign',
          name: 'campaign',
          // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
          type: 'string',
          default: '',
        },
        {
          displayName: 'Status',
          name: 'status',
          type: 'options',
          options: [
            // Sentinel: empty value means "no change" so untouched status
            // doesn't clobber existing workflow state. The handler
            // drops empty strings from the body.
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
          // eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
          type: 'string',
          typeOptions: { multipleValues: true },
          default: [],
          description: 'Tag names to attach (existing tags are preserved)',
        },
      ],
    },
  ];
}
