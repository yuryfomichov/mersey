import type { ModelToolDefinition, ModelToolInput, ToolContentPart } from '../models/types.js';
import type { ToolExecutionContext, ToolExecutionResult } from './catalog.js';

export type ToolInputSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

export type ToolInput = {
  [key: string]: unknown;
};

export type ToolExecuteResult = ToolExecutionResult;

export function createTextToolResult(
  text: string,
  options: {
    isError?: boolean;
    metadata?: Record<string, unknown>;
  } = {},
): ToolExecutionResult {
  return {
    isError: options.isError,
    metadata: options.metadata,
    parts: [{ text, type: 'text' } satisfies ToolContentPart],
  };
}

export interface Tool extends ModelToolDefinition {
  execute(input: ModelToolInput, context: ToolExecutionContext): Promise<ToolExecuteResult>;
}

export type { ToolExecutionContext, ToolExecutionResult };
