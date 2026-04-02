import { realpath } from 'node:fs/promises';

import type { ModelToolCall, ModelToolDefinition } from '../../models/types.js';
import type { Tool, ToolExecutionResult } from '../types.js';
import { CancellationService } from './cancellation/cancellation-service.js';
import { CommandService } from './commands/command-service.js';
import { FileService } from './files/file-service.js';
import { resolvePathInWorkspace } from './files/path-utils.js';
import { OutputService } from './output/output-service.js';
import type {
  ToolExecutionPolicy,
  ToolRuntime,
  ToolRuntimeFactory,
  ToolRuntimeFactoryOptions,
  ToolRuntimeOptions,
  ToolRuntimeServices,
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

async function executeToolCall(
  toolCall: ModelToolCall,
  tools: Map<string, Tool>,
  runtimeServices: ToolRuntimeServices,
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
    const result = await tool.execute(toolCall.input, runtimeServices);

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

export function createToolRuntimeFactory({ policy, tools }: ToolRuntimeFactoryOptions): ToolRuntimeFactory {
  let canonicalWorkspaceRoot: string | null = null;
  let canonicalWorkspaceRootPromise: Promise<string> | null = null;
  const getCanonicalWorkspaceRoot = async (): Promise<string> => {
    if (canonicalWorkspaceRoot) {
      return canonicalWorkspaceRoot;
    }

    if (!canonicalWorkspaceRootPromise) {
      canonicalWorkspaceRootPromise = realpath(policy.workspaceRoot)
        .then((resolvedWorkspaceRoot) => {
          canonicalWorkspaceRoot = resolvedWorkspaceRoot;
          return resolvedWorkspaceRoot;
        })
        .finally(() => {
          canonicalWorkspaceRootPromise = null;
        });
    }

    return canonicalWorkspaceRootPromise;
  };

  const files = new FileService({ getCanonicalWorkspaceRoot, policy });
  const output = new OutputService(policy);
  const toolDefinitions = getToolDefinitions(tools);
  const toolMap = getToolMap(tools);

  const toolRuntimeFactory = (options: { signal?: AbortSignal } = {}): ToolRuntime => {
    const cancellation = new CancellationService({ signal: options.signal });

    const runtimeServices: ToolRuntimeServices = {
      cancellation,
      commands: new CommandService({
        cancellation,
        getDefaultCwd: getCanonicalWorkspaceRoot,
        resolveCwd: (cwd, cwdToolName) => resolvePathInWorkspace(cwd, policy.workspaceRoot, { toolName: cwdToolName }),
      }),
      files,
      output,
    };

    return {
      ...runtimeServices,
      executeToolCall(toolCall: ModelToolCall): Promise<ToolExecutionResult> {
        return executeToolCall(toolCall, toolMap, runtimeServices);
      },
      toolDefinitions,
    };
  };

  toolRuntimeFactory.toolDefinitions = toolDefinitions;

  return toolRuntimeFactory;
}

export function createToolRuntime({ policy, signal, tools }: ToolRuntimeOptions): ToolRuntime {
  return createToolRuntimeFactory({ policy, tools })({ signal });
}

export type {
  ToolRuntime,
  ToolRuntimeFactory,
  ToolRuntimeFactoryOptions,
  ToolRuntimeOptions,
  ToolRuntimeServices,
  ToolExecutionPolicy,
  ToolFileAccess,
  ToolOutputLimitResult,
  ToolPathDenyRule,
} from './types.js';
