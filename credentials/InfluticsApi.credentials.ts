import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class InfluticsApi implements ICredentialType {
  name = 'influticsApi';
  displayName = 'Influtics API';
  documentationUrl = 'https://docs.influtics.com/';
  icon = 'file:influtics.svg' as const;
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
  test = {
    request: {
      baseURL: 'https://api.influtics.com',
      url: '/v1/account/limits',
      method: 'GET' as const,
    },
  };
}
