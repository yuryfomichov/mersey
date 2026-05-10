import type { AssistantToolCall, ModelUsage, ToolContentPart } from '../models/types.js';

export type UserMessage = {
  role: 'user';
  content: string;
  createdAt: string;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  createdAt: string;
  toolCalls?: AssistantToolCall[];
  usage?: ModelUsage;
};

export type ToolMessage = {
  role: 'tool';
  content: string;
  createdAt: string;
  isError?: boolean;
  metadata?: Record<string, unknown>;
  parts: ToolContentPart[];
  publicName: string;
  toolCallId: string;
  toolId: string;
};

export type Message = UserMessage | AssistantMessage | ToolMessage;

export type SessionState = {
  id: string;
  createdAt: string;
  messages: Message[];
};

export type StoredSessionState = SessionState & {
  usage: ModelUsage;
  contextSize: number;
};
