import {
  EditFileTool,
  ReadFileTool,
  RunCommandTool,
  WriteFileTool,
  type ProviderDefinition,
  type Tool,
  type ToolExecutionPolicy,
} from '../../../harness/index.js';

export const DEFAULT_COMMAND_ALLOWLIST = ['git', 'ls', 'pwd'] as const;

type CreateDefaultToolsOptions = {
  commandAllowlist?: readonly string[];
};

export function getToolExecutionPolicy(workspaceRoot: string = process.cwd()): ToolExecutionPolicy {
  return {
    maxToolResultBytes: 16 * 1024,
    workspaceRoot,
  };
}

export function createDefaultTools(options: CreateDefaultToolsOptions = {}): Tool[] {
  return [
    new ReadFileTool(),
    new WriteFileTool(),
    new EditFileTool(),
    new RunCommandTool({
      commandAllowlist: [...(options.commandAllowlist ?? DEFAULT_COMMAND_ALLOWLIST)],
      defaultTimeoutMs: 5_000,
      maxOutputBytes: 16 * 1024,
      maxTimeoutMs: 15_000,
    }),
  ];
}

export function getProviderModel(provider: ProviderDefinition): string | null {
  return 'config' in provider && provider.config?.model ? provider.config.model : null;
}
