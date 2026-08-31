// nodes/Influtics/resources/video.ts
import type { INodeProperties } from 'n8n-workflow';
import type { OperationHandler } from '../Influtics.node';

export const VIDEO_OPERATIONS: Record<string, OperationHandler> = {};

export function videoProperties(): INodeProperties[] {
  return [];
}
