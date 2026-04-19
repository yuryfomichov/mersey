import type { ModelToolCall, ModelToolDefinition } from '../../models/types.js';
import type { Tool, ToolExecutionResult } from '../types.js';
import { CancellationService } from './cancellation/cancellation-service.js';
import type {
  ToolExecutionContext,
  ToolRuntime,
  ToolRuntimeFactory,
  ToolRuntimeFactoryOptions,
  ToolRuntimeOptions,
} from './types.js';

function getToolDefinitions(tools: Tool[]): ModelToolDefinition[] | undefined {
  if (tools.length === 0) {
    return undefined;
  }

  return tools.map(({ description, inputSchema, name }) => ({
    description,
    inputSchema,
    name,
  }));
}

function getToolMap(tools: Tool[]): Map<string, Tool> {
  return new Map(tools.map((tool) => [tool.name, tool]));
}

function assertUniqueToolNames(tools: Tool[]): void {
  const seen = new Set<string>();

  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name registered: ${tool.name}`);
    }

    seen.add(tool.name);
  }
}

async function executeToolCall(
  toolCall: ModelToolCall,
  tools: Map<string, Tool>,
  executionContext: ToolExecutionContext,
): Promise<ToolExecutionResult> {
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
    const result = await tool.execute(toolCall.input, executionContext);

    return {
      content: result.content,
      data: result.data,
      isError: result.isError,
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

export function createToolRuntimeFactory({ tools }: ToolRuntimeFactoryOptions): ToolRuntimeFactory {
  assertUniqueToolNames(tools);
  const toolDefinitions = getToolDefinitions(tools);
  const toolMap = getToolMap(tools);

  const toolRuntimeFactory = (options: { signal?: AbortSignal } = {}): ToolRuntime => {
    const cancellation = new CancellationService({ signal: options.signal });

    const executionContext: ToolExecutionContext = {
      cancellation,
    };

    return {
      ...executionContext,
      executeToolCall(toolCall: ModelToolCall): Promise<ToolExecutionResult> {
        return executeToolCall(toolCall, toolMap, executionContext);
      },
      toolDefinitions,
    };
  };

  toolRuntimeFactory.toolDefinitions = toolDefinitions;

  return toolRuntimeFactory;
}

export function createToolRuntime({ signal, tools }: ToolRuntimeOptions): ToolRuntime {
  return createToolRuntimeFactory({ tools })({ signal });
}

export type {
  ToolExecutionContext,
  ToolRuntime,
  ToolRuntimeFactory,
  ToolRuntimeFactoryOptions,
  ToolRuntimeOptions,
  ToolExecutionPolicy,
  ToolFileAccess,
  ToolOutputLimitResult,
  ToolPathDenyRule,
} from './types.js';
