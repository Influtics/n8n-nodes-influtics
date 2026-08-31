// nodes/Influtics/resources/trend.ts
import type { INodeProperties } from 'n8n-workflow';
import type { OperationHandler } from '../Influtics.node';

export const TREND_OPERATIONS: Record<string, OperationHandler> = {};

export function trendProperties(): INodeProperties[] {
  return [];
}
