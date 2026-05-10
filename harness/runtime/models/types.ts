import type { NormalizedTurnContext } from '../context/types.js';

export type ModelToolInput = {
  [key: string]: unknown;
};

export type ToolContentPart =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'json';
      value: unknown;
    }
  | {
      type: 'resource';
      uri: string;
      mimeType?: string;
      text?: string;
    };

export type ModelToolDefinition = {
  description: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
  name: string;
};

export type ModelToolCall = {
  id: string;
  input: ModelToolInput;
  name: string;
};

export type AssistantToolCall = ModelToolCall & {
  originalName: string;
  publicName: string;
  sourceId: string;
  toolId: string;
};

export type ModelUsage = {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  outputTokens: number;
};

export function createEmptyModelUsage(): ModelUsage {
  return {
    cacheWriteInputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    uncachedInputTokens: 0,
  };
}

export type ModelUserMessage = {
  role: 'user';
  content: string;
};

export type ModelAssistantMessage = {
  role: 'assistant';
  content: string;
  toolCalls?: AssistantToolCall[];
};

export type ModelToolResultMessage = {
  role: 'tool';
  content: string;
  metadata?: Record<string, unknown>;
  isError?: boolean;
  parts: ToolContentPart[];
  publicName: string;
  toolCallId: string;
  toolId: string;
};

export type ModelMessage = ModelUserMessage | ModelAssistantMessage | ModelToolResultMessage;

export type ModelRequest = {
  context?: NormalizedTurnContext;
  messages: ModelMessage[];
  signal?: AbortSignal;
  stream: boolean;
  systemPrompt?: string;
  tools?: ModelToolDefinition[];
};

export type ModelResponse = {
  text: string;
  toolCalls?: ModelToolCall[];
  usage: ModelUsage;
};

export type ModelStreamEvent =
  | {
      delta: string;
      type: 'text_delta';
    }
  | {
      response: ModelResponse;
      type: 'response_completed';
    };
