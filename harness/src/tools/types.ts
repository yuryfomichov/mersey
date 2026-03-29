import type { ModelToolDefinition, ModelToolInput } from '../models/index.js';

export type ToolExecutionResult = {
  content: string;
  isError?: boolean;
  name: string;
  toolCallId: string;
};

export interface Tool extends ModelToolDefinition {
  execute(input: ModelToolInput): Promise<string>;
}
