import type { ToolCallPolicy } from '../approvals/types.js';
import type { ModelToolDefinition, ModelToolInput } from '../models/types.js';
import type { ToolRuntimeServices } from './runtime/index.js';

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
  execute(input: ModelToolInput, runtime: ToolRuntimeServices): Promise<ToolExecuteResult>;
}

export type HarnessTool = {
  policy: ToolCallPolicy;
  tool: Tool;
};
