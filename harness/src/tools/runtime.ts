import type { ModelToolCall, ModelToolDefinition } from '../models/index.js';
import type { Tool, ToolExecutionResult } from './types.js';

export function getToolDefinitions(tools: Tool[]): ModelToolDefinition[] | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  return tools.map(({ description, inputSchema, name }) => ({
    description,
    inputSchema,
    name,
  }));
}

export function getToolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

export async function executeToolCall(toolCall: ModelToolCall, tools: Map<string, Tool>): Promise<ToolExecutionResult> {
  const tool = tools.get(toolCall.name);

  if (!tool) {
    return {
      content: `Unknown tool: ${toolCall.name}`,
      isError: true,
      name: toolCall.name,
      toolCallId: toolCall.id,
    };
  }

  try {
    return {
      content: await tool.execute(toolCall.input),
      name: toolCall.name,
      toolCallId: toolCall.id,
    };
  } catch (error: unknown) {
    return {
      content: error instanceof Error ? error.message : String(error),
      isError: true,
      name: toolCall.name,
      toolCallId: toolCall.id,
    };
  }
}
