import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class InfluticsApi implements ICredentialType {
  name = 'influticsApi';
  displayName = 'Influtics API';
  documentationUrl = 'https://docs.influtics.com/';
  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      description: 'Get your API key from the Influtics dashboard under Settings → API',
    },
  ];
  authenticate = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{ $credentials.apiKey }}',
      },
    },
  } as const;
}
