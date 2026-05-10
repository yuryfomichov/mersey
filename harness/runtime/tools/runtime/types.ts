import type { ToolExecutionContext } from '../catalog.js';
import type { Tool } from '../types.js';

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
  getMaxReadBytes(): number;
  resolveForRead(path: string, toolName: string): Promise<string>;
  resolveForReadWrite(path: string, toolName: string): Promise<string>;
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

export type ToolRuntimeFactoryOptions = {
  tools: Tool[];
};

export type { ToolExecutionContext };
