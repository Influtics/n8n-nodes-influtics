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
import { influticsApiRequest } from '../GenericFunctions.js';

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
            name: 'Track',
            value: 'track',
            description: 'Track videos by URL',
            action: 'Track videos by URL',
          },
        ],
        default: 'track',
      },
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
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executeInfluticsVideo.call(this, this.getInputData());
  }
}
