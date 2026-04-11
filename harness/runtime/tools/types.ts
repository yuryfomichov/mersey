import type { ModelToolDefinition, ModelToolInput } from '../models/types.js';
import type { ToolExecutionContext } from './runtime/index.js';

export type ToolInputSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type ToolInput = {
  [key: string]: unknown;
};

export type ToolResultData = Record<string, unknown>;

export type ToolExecuteResult = {
  content: string;
  data?: ToolResultData;
  isError?: boolean;
};

export type ToolExecutionResult = {
  content: string;
  data?: ToolResultData;
  isError?: boolean;
  name: string;
  toolCallId: string;
};

export interface Tool extends ModelToolDefinition {
  execute(input: ModelToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult>;
}
