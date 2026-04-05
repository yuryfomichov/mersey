import { type ProviderDefinition } from '../../../harness/index.js';
import {
  EditFileTool,
  ReadFileTool,
  RunCommandTool,
  type Tool,
  type ToolExecutionPolicy,
  WriteFileTool,
} from '../../../harness/tools/index.js';

export const DEFAULT_COMMAND_ALLOWLIST = ['git', 'ls', 'pwd'] as const;

type CreateDefaultToolsOptions = {
  commandAllowlist?: readonly string[];
  toolExecutionPolicy?: ToolExecutionPolicy;
};

export function getToolExecutionPolicy(workspaceRoot: string = process.cwd()): ToolExecutionPolicy {
  return {
    maxToolResultBytes: 16 * 1024,
    workspaceRoot,
  };
}

export function createDefaultTools(options: CreateDefaultToolsOptions = {}): Tool[] {
  const toolExecutionPolicy = options.toolExecutionPolicy ?? getToolExecutionPolicy();

  return [
    new ReadFileTool({ policy: toolExecutionPolicy }),
    new WriteFileTool({ policy: toolExecutionPolicy }),
    new EditFileTool({ policy: toolExecutionPolicy }),
    new RunCommandTool({
      commandAllowlist: [...(options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST)],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      maxTimeoutMs: 15_000,
      policy: toolExecutionPolicy,
    }),
  ];
}

export function getProviderModel(provider: ProviderDefinition): string | null {
  return 'config' in provider && provider.config?.model ? provider.config.model : null;
}
