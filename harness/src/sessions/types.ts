import type { ModelToolCall } from '../models/types.js';

export type UserMessage = {
  role: 'user';
  content: string;
  createdAt: string;
};

export type AssistantMessage = {
  role: 'assistant';
  content: string;
  createdAt: string;
  toolCalls?: ModelToolCall[];
};

export type ToolMessage = {
  role: 'tool';
  content: string;
  createdAt: string;
  data?: Record<string, unknown>;
  isError?: boolean;
  name: string;
  toolCallId: string;
};

export type Message = UserMessage | AssistantMessage | ToolMessage;

export type Session = {
  id: string;
  createdAt: string;
  messages: Message[];
};
