import type { ToolCallAction } from '../../approvals/types.js';
import type { ModelToolCall, ModelToolDefinition } from '../../models/types.js';
import type { HarnessTool, ToolExecutionResult } from '../types.js';
import type { ToolCommandRunner } from './commands/types.js';

export type ToolFileAccess = 'read' | 'write';

export type ToolPathDenyRule = {
  access?: ToolFileAccess[];
  basename?: string;
  basenamePrefix?: string;
  extension?: string;
  path?: string;
  pathPrefix?: string;
  reason?: string;
  tools?: string[];
};

export type ToolExecutionPolicy = {
  maxReadBytes?: number;
  maxToolResultBytes?: number;
  maxWriteBytes?: number;
  pathDenylist?: ToolPathDenyRule[];
  workspaceRoot: string;
};

export type ToolOutputLimitResult = {
  originalBytes: number;
  text: string;
  truncated: boolean;
};

export type ToolFileService = {
  assertReadSize(path: string, toolName: string): Promise<void>;
  assertWriteSize(content: string, toolName: string): void;
  resolveForRead(path: string, toolName: string): Promise<string>;
  resolveForWrite(path: string, toolName: string): Promise<string>;
};

export type ToolOutputService = {
  limitResult(text: string): ToolOutputLimitResult;
  limitText(text: string, maxBytes?: number): ToolOutputLimitResult;
};

export type ToolCancellationService = {
  signal(): AbortSignal | undefined;
  throwIfAborted(): void;
};

export type ToolRuntimeServices = {
  cancellation: ToolCancellationService;
  commands: ToolCommandRunner;
  files: ToolFileService;
  output: ToolOutputService;
};

export type ToolRuntime = ToolRuntimeServices & {
  executeToolCall(toolCall: ModelToolCall): Promise<ToolExecutionResult>;
  getToolCallAction(toolCall: ModelToolCall): ToolCallAction;
  toolDefinitions: ModelToolDefinition[] | undefined;
};

export type ToolRuntimeFactory = ((options?: { signal?: AbortSignal }) => ToolRuntime) & {
  toolDefinitions: ModelToolDefinition[] | undefined;
};

export type ToolRuntimeFactoryOptions = {
  policy: ToolExecutionPolicy;
  tools: HarnessTool[];
};

export type ToolRuntimeOptions = ToolRuntimeFactoryOptions & {
  signal?: AbortSignal;
};
