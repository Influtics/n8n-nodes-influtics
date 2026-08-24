/**
 * Influtics Video node.
 *
 * Implementation choices:
 * - File lives at nodes/InfluticsVideo/InfluticsVideo.node.ts — required by the
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention` rule.
 * - `executeInfluticsVideo` is also exported as a named function so unit tests
 *   can drive the executor without instantiating the INodeType class.
 * - The description "Track and read" is forward-looking; other operations land
 *   in Tasks 5–7 but each ships as a separate commit so the diff stays small.
 * - The unimplemented-operation branch keeps the executor safe if a future
 *   version's parameters somehow leak an unknown value.
 */
import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest, influticsApiRequestAllItems } from '../GenericFunctions.js';

// Per-operation handler map. Track is a single batch op; one call per workflow
// run regardless of input item count. Future operations (Tasks 5–7) add a key
// + tests here without growing the executor's else-if chain.
type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

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
    // own server-side defaults). Empty string / empty array → omit.
    // Defensive coercion: n8n returns `''` for empty string props, but custom
    // callers (and tests) may pass an empty array — `[]` is truthy in JS, so we
    // must explicitly check `Array.isArray` before truthiness.
    const platformRaw = this.getNodeParameter('platform', i, []) as unknown;
    const platform = Array.isArray(platformRaw) ? (platformRaw as string[]) : [];
    const campaignRaw = this.getNodeParameter('campaign', i, '');
    const campaign = typeof campaignRaw === 'string' ? campaignRaw : '';
    const bloggerRaw = this.getNodeParameter('blogger', i, '');
    const blogger = typeof bloggerRaw === 'string' ? bloggerRaw : '';
    const search = this.getNodeParameter('search', i, '') as string;
    const publishedFrom = this.getNodeParameter('publishedFrom', i, '') as string;
    const publishedTo = this.getNodeParameter('publishedTo', i, '') as string;
    const returnAll = this.getNodeParameter('returnAll', i, false) as boolean;
    // `limit` is only meaningful when `returnAll` is false; the `returnAll` paginator
    // walks `meta.next_cursor` and owns the page count, so a limit there would just
    // be ignored (or worse, fight the cursor walk). The UI hides this field under
    // the same `returnAll: [false]` guard so callers won't set it for `returnAll`
    // branches, but we still gate here for safety.
    //
    // The Influtics public docs for GET /v1/videos/stats name the param `limit`
    // (range 1–100, default 50). The Influtics MCP server's `list_tracked_videos`
    // tool uses `page_size` instead — different endpoint contract, not a typo.
    const limitRaw = this.getNodeParameter('limit', i, 50) as unknown;
    const limit = typeof limitRaw === 'number' && limitRaw > 0 ? limitRaw : undefined;
    const qs: IDataObject = {};
    if (platform.length > 0) qs.platform = platform;
    if (campaign) qs.campaign = campaign;
    if (blogger) qs.blogger = blogger;
    if (search) qs.search = search;
    if (publishedFrom) qs.published_from = publishedFrom;
    if (publishedTo) qs.published_to = publishedTo;
    // Lenient: omit `limit` when missing / non-positive so the server's own
    // default (50) wins. Throwing here would punish custom callers that pass
    // a stale schema.
    if (!returnAll && limit !== undefined) qs.limit = limit;

    // Cursor paginator walks `meta.next_cursor`; single-call returns the raw
    // envelope (success/data/meta). Either way one logical "read" per workflow.
    return returnAll
      ? ({ data: await influticsApiRequestAllItems.call(this, 'GET', '/v1/videos/stats', qs) } as IDataObject)
      : ((await influticsApiRequest.call(this, 'GET', '/v1/videos/stats', undefined, qs)) as IDataObject);
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
    icon: 'file:influtics.svg',
    group: ['transform'],
    version: 1,
    description: 'Track and read Influtics videos',
    defaults: { name: 'Influtics Video' },
    inputs: ['main'],
    outputs: ['main'],
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
        typeOptions: { minValue: 1 },
        default: 50,
        description: 'Max number of results to return',
      },
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'multiOptions',
        displayOptions: { show: { operation: ['getStats'] } },
        options: [
          { name: 'TikTok', value: 'tiktok' },
          { name: 'Instagram', value: 'instagram' },
          { name: 'YouTube', value: 'youtube' },
          { name: 'VK', value: 'vk' },
        ],
        default: [],
        description: 'Restrict to one or more platforms',
      },
      {
        displayName: 'Campaign',
        name: 'campaign',
        type: 'string',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
        description: 'Filter by campaign tag',
      },
      {
        displayName: 'Blogger Username',
        name: 'blogger',
        type: 'string',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
        description: 'Filter by blogger username',
      },
      {
        displayName: 'Search',
        name: 'search',
        type: 'string',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
        description: 'Free-text search across tracked videos',
      },
      {
        displayName: 'Published From',
        name: 'publishedFrom',
        type: 'dateTime',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
      },
      {
        displayName: 'Published To',
        name: 'publishedTo',
        type: 'dateTime',
        displayOptions: { show: { operation: ['getStats'] } },
        default: '',
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
              { name: 'To Do', value: 'to do' },
              { name: 'Running', value: 'running' },
              { name: 'Ended', value: 'ended' },
            ],
            default: 'to do',
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
