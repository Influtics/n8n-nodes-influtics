import type { IExecuteFunctions, IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const INFLUTICS_API_BASE_URL = 'https://api.influtics.com';
export const CREDENTIAL_NAME = 'influticsApi';

interface ApiErrorBody {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    upgrade_url?: string;
    request_id?: string;
    [k: string]: unknown;
  };
}

function extractApiErrorBody(error: any): { code?: string; message?: string; upgrade_url?: string } {
  const body: ApiErrorBody | undefined = error?.response?.body;
  const inner = body?.error;
  return {
    code: inner?.code,
    message: inner?.message,
    upgrade_url: (inner as any)?.upgrade_url,
  };
}

export function mapInfluticsError(error: any): Error {
  const { code, message, upgrade_url } = extractApiErrorBody(error);
  if (code || message) {
    const descParts: string[] = [];
    if (upgrade_url) descParts.push(`Upgrade: ${upgrade_url}`);
    const finalMessage = `${code ?? 'API_ERROR'}: ${message ?? 'Unknown error'}`;
    const e = new Error(finalMessage);
    (e as any).description = descParts.join('\n') || undefined;
    return e;
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function influticsApiRequest(
  this: IExecuteFunctions,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  endpoint: string,
  body?: IDataObject,
  qs?: IDataObject,
): Promise<any> {
  const options: IHttpRequestOptions = {
    method,
    url: `${INFLUTICS_API_BASE_URL}${endpoint}`,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // Authorization header is injected by the credential's `authenticate` block.
    },
    json: true,
    ...(body ? { body } : {}),
    ...(qs ? { qs } : {}),
  };

  try {
    const response = await this.helpers.httpRequestWithAuthentication.call(
      this,
      CREDENTIAL_NAME,
      options,
    );
    return response;
  } catch (rawError: any) {
    // Map the raw helper error into { code, message, description }. The description
    // carries the upgrade URL on 402 PAID_PLAN_REQUIRED so it surfaces in the n8n UI
    // without code-fishing. Both message AND description MUST go through NodeApiError's
    // options bag, since the wrapped `rawError` itself has no description on it.
    const mapped = mapInfluticsError(rawError);
    throw new NodeApiError(this.getNode(), rawError, {
      message: mapped.message,
      description: (mapped as any).description,
    });
  }
}

/**
 * Cursor-aware paginator for endpoints that expose `next_cursor`. Influtics
 * returns the cursor under `meta.next_cursor`; we fold every page's `data`
 * into a single array so downstream n8n nodes see one item per record.
 *
 * Endpoints that don't paginate today just return a single page (no cursor);
 * in that case the caller still gets back one combined array.
 */
export async function influticsApiRequestAllItems(
  this: IExecuteFunctions,
  method: 'GET',
  endpoint: string,
  qs?: IDataObject,
): Promise<any[]> {
  const aggregated: any[] = [];
  let cursor: string | undefined;

  // Hard cap on pages so a runaway cursor can't DOS the workflow.
  for (let page = 0; page < 50; page++) {
    const pageQs: IDataObject = { ...(qs ?? {}) };
    if (cursor) pageQs.cursor = cursor;

    const response = await influticsApiRequest.call(this, method, endpoint, undefined, pageQs);
    const items: any[] = Array.isArray(response?.data) ? response.data : [];
    aggregated.push(...items);

    const next = response?.meta?.next_cursor;
    if (!next) break;
    cursor = next;
  }

  return aggregated;
}