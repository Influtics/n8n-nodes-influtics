/**
 * Influtics single action node (v1.1.0).
 *
 * Consolidates Influtics Account / Blogger / Trend / Video into one node per
 * the n8n verified-nodes "one regular node per package" guideline.
 *
 * Implementation choices:
 * - File lives at nodes/Influtics/Influtics.node.ts — required by
 *   eslint-plugin-n8n-nodes-base `node-dirname-against-convention`.
 * - `executeInflutics` is also exported as a named function so unit tests can
 *   drive the dispatcher without instantiating the INodeType class.
 * - Per-resource OperationHandler maps live in `resources/{name}.ts`; the
 *   dispatcher below looks up `OPERATIONS[resource][operation]`.
 * - The unimplemented-resource / unimplemented-operation branch keeps the
 *   executor safe if a future version's parameters somehow leak an unknown
 *   value.
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
import { accountProperties, ACCOUNT_OPERATIONS } from './resources/account';
import { bloggerProperties, BLOGGER_OPERATIONS } from './resources/blogger';
import { trendProperties,   TREND_OPERATIONS }   from './resources/trend';
import { videoProperties,   VIDEO_OPERATIONS }   from './resources/video';

export type OperationHandler = (
  this: IExecuteFunctions,
  _i: number,
) => Promise<IDataObject>;

type ResourceKey = 'account' | 'blogger' | 'trend' | 'video';

const OPERATIONS: Record<ResourceKey, Record<string, OperationHandler>> = {
  account: ACCOUNT_OPERATIONS,
  blogger: BLOGGER_OPERATIONS,
  trend:   TREND_OPERATIONS,
  video:   VIDEO_OPERATIONS,
};

export async function executeInflutics(
  this: IExecuteFunctions,
  _items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const resource = this.getNodeParameter('resource', 0) as ResourceKey;
  const operation = this.getNodeParameter('operation', 0) as string;
  const handler = OPERATIONS[resource]?.[operation];
  if (!handler) {
    throw new NodeOperationError(
      this.getNode(),
      `Operation "${operation}" not implemented for resource "${resource}"`,
    );
  }
  // All eleven ops are single-batch: one HTTP call per workflow run regardless
  // of input item count. Mirrors the InfluticsAccount/Video/Trend/Blogger
  // single-batch patterns.
  const response = await handler.call(this, 0);
  return [[{ json: response }]];
}

export class Influtics implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Influtics',
    name: 'influtics',
    icon: { light: 'file:influtics-light.svg', dark: 'file:influtics-dark.svg' },
    group: ['transform'],
    // Bumped from 1 (the four old nodes were version 1). Breaking change is
    // declared in CHANGELOG v1.1.0; existing workflows must be re-created.
    version: 2,
    subtitle: '={{$parameter["resource"]}} → {{$parameter["operation"]}}',
    description: 'Track videos, manage bloggers, search trends, and read account usage',
    defaults: { name: 'Influtics' },
    // eslint-disable-next-line n8n-nodes-base/node-class-description-inputs-wrong-regular-node -- scanner `@n8n/community-nodes/node-connection-type-literal` requires the enum; the local plugin (1.16.0) wants the literal and is stale against newer n8n-workflow APIs.
    inputs: [NodeConnectionTypes.Main],
    // eslint-disable-next-line n8n-nodes-base/node-class-description-outputs-wrong -- scanner requires the enum (see inputs comment above); satisfying it is what blocks v1.1.0 ship.
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: 'influticsApi', required: true }],
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Account', value: 'account' },
          { name: 'Blogger', value: 'blogger' },
          { name: 'Trend',   value: 'trend'   },
          { name: 'Video',   value: 'video'   },
        ],
        default: 'video',
      },
      ...accountProperties(),
      ...bloggerProperties(),
      ...trendProperties(),
      ...videoProperties(),
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInflutics.call(this, this.getInputData());
  }
}
