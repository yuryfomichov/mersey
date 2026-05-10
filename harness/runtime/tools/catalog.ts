import type { ModelToolCall, ModelToolDefinition, ModelToolInput } from '../models/types.js';

export type ToolIdentity = {
  originalName: string;
  publicName: string;
  sourceId: string;
  sourceType: 'local' | 'mcp';
  toolId: string;
};

export type ToolDescriptor = {
  definition: ModelToolDefinition;
  identity: ToolIdentity;
};

export type ResolvedToolCall = {
  input: ModelToolInput;
  originalName: string;
  publicName: string;
  rawCall: ModelToolCall;
  sourceId: string;
  toolCallId: string;
  toolId: string;
};

export type ToolCatalogSnapshotContext = {
  iteration: number;
  sessionId: string;
  turnId: string;
};

export type ToolCancellationService = {
  signal(): AbortSignal | undefined;
  throwIfAborted(): void;
};

export type ToolExecutionContext = {
  cancellation: ToolCancellationService;
};

export type ToolExecutionResult = {
  isError?: boolean;
  metadata?: Record<string, unknown>;
  parts: import('../models/types.js').ToolContentPart[];
};

export interface ToolCatalogSnapshot {
  readonly descriptors: readonly ToolDescriptor[];

  execute(call: ResolvedToolCall, ctx: ToolExecutionContext): Promise<ToolExecutionResult>;
  resolve(call: ModelToolCall): ResolvedToolCall | null;
}

export interface ToolCatalog {
  snapshot(ctx: ToolCatalogSnapshotContext): Promise<ToolCatalogSnapshot>;
}
