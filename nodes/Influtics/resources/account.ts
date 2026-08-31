// nodes/Influtics/resources/account.ts
import type { INodeProperties } from 'n8n-workflow';
import type { OperationHandler } from '../Influtics.node';

export const ACCOUNT_OPERATIONS: Record<string, OperationHandler> = {};

export function accountProperties(): INodeProperties[] {
  return [];
}
