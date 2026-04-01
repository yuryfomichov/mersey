import type { ModelToolDefinition, ModelToolInput } from '../models/index.js';
import type { ToolContext } from './context.js';

export type ToolResultData = Record<string, unknown>;

export type ToolApprovalRequirement =
  | {
      mode: 'auto';
    }
  | {
      mode: 'require';
    };

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
  execute(input: ModelToolInput, context: ToolContext): Promise<ToolExecuteResult>;
  getApprovalRequirement?(input: ModelToolInput): ToolApprovalRequirement;
}
