export type ModelToolInput = {
  [key: string]: unknown;
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

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

export type ModelUserMessage = {
  role: 'user';
  content: string;
};

export type ModelAssistantMessage = {
  role: 'assistant';
  content: string;
  toolCalls?: ModelToolCall[];
};

export type ModelToolResultMessage = {
  role: 'tool';
  content: string;
  data?: Record<string, unknown>;
  isError?: boolean;
  name: string;
  toolCallId: string;
};

export type ModelMessage = ModelUserMessage | ModelAssistantMessage | ModelToolResultMessage;

export type ModelRequest = {
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
