// nodes/Influtics/resources/blogger.ts
import type { INodeProperties } from 'n8n-workflow';
import type { OperationHandler } from '../Influtics.node';

export const BLOGGER_OPERATIONS: Record<string, OperationHandler> = {};

export function bloggerProperties(): INodeProperties[] {
  return [];
}
