import {
  NodeOperationError,
  type IDataObject,
  type IExecuteFunctions,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';
import { influticsApiRequest } from '../GenericFunctions.js';

export async function executeInfluticsVideo(
  this: IExecuteFunctions,
  items: INodeExecutionData[],
): Promise<INodeExecutionData[][]> {
  const operation = this.getNodeParameter('operation', 0) as string;
  const returnData: INodeExecutionData[] = [];

  for (let i = 0; i < items.length; i++) {
    if (operation === 'track') {
      const urlsParam = this.getNodeParameter('urls', i) as { urls: string[] };
      const response = await influticsApiRequest.call(
        this,
        'POST',
        '/v1/videos/track',
        { urls: urlsParam.urls } as IDataObject,
      );
      returnData.push({ json: response });
    } else {
      throw new NodeOperationError(
        this.getNode(),
        `Operation "${operation}" not yet implemented in InfluticsVideo node`,
      );
    }
  }
  return [returnData];
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