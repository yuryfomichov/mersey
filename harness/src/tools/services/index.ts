import { realpath } from 'node:fs/promises';

import type { ModelToolCall, ModelToolDefinition } from '../../models/types.js';
import type { Tool, ToolExecutionResult } from '../types.js';
import { CommandService } from './commands/command-service.js';
import { FileService } from './files/file-service.js';
import { resolvePathInWorkspace } from './files/path-utils.js';
import { OutputService } from './output/output-service.js';
import type { ToolExecutionPolicy, ToolRuntime, ToolRuntimeOptions, ToolServices } from './types.js';

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

async function executeToolCall(
  toolCall: ModelToolCall,
  tools: Map<string, Tool>,
  services: ToolServices,
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
    const result = await tool.execute(toolCall.input, services);

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

export function createToolServices(policy: ToolExecutionPolicy, options: { signal?: AbortSignal } = {}): ToolServices {
  let canonicalWorkspaceRootPromise: Promise<string> | null = null;
  const getCanonicalWorkspaceRoot = async (): Promise<string> => {
    if (!canonicalWorkspaceRootPromise) {
      canonicalWorkspaceRootPromise = realpath(policy.workspaceRoot);
    }

    return canonicalWorkspaceRootPromise;
  };

  return {
    commands: new CommandService({
      getDefaultCwd: getCanonicalWorkspaceRoot,
      resolveCwd: (cwd, cwdToolName) => resolvePathInWorkspace(cwd, policy.workspaceRoot, { toolName: cwdToolName }),
      signal: options.signal,
    }),
    files: new FileService({ getCanonicalWorkspaceRoot, policy }),
    output: new OutputService(policy),
    signal: options.signal,
  };
}

export function createToolRuntime({ policy, signal, tools }: ToolRuntimeOptions): ToolRuntime {
  const services = createToolServices(policy, { signal });
  const toolMap = getToolMap(tools);

  return {
    ...services,
    executeToolCall(toolCall: ModelToolCall): Promise<ToolExecutionResult> {
      return executeToolCall(toolCall, toolMap, services);
    },
    toolDefinitions: getToolDefinitions(tools),
  };
}

export type {
  ToolRuntime,
  ToolRuntimeOptions,
  ToolServices,
  ToolExecutionPolicy,
  ToolFileAccess,
  ToolOutputLimitResult,
  ToolPathDenyRule,
} from './types.js';
