import type { PendingApproval } from '../approvals/types.js';
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

export type TurnStatus = 'awaiting_approval' | 'idle';

export type SessionState = {
  id: string;
  createdAt: string;
  pendingApproval: PendingApproval | null;
  turnStatus: TurnStatus;
  messages: Message[];
};
