import type { ModelToolCall } from '../models/index.js';

export type TurnStatus = 'idle' | 'running' | 'awaiting_approval';

export type PendingApprovalToolResult = {
  content: string;
  data?: Record<string, unknown>;
  isError?: boolean;
  name: string;
  toolCallId: string;
};

export type PendingApprovalState =
  | {
      stage: 'awaiting_user';
      toolCallId: string;
    }
  | {
      stage: 'approved_executing';
      toolCallId: string;
    }
  | {
      stage: 'approved_executed';
      toolCallId: string;
      toolResult: PendingApprovalToolResult;
    }
  | {
      stage: 'denied_executed';
      toolCallId: string;
      toolResult: PendingApprovalToolResult;
    };

export type SessionStatePatch = {
  currentTurnId?: string | null;
  pendingApproval?: PendingApprovalState | null;
  turnStatus?: TurnStatus;
};

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
  currentTurnId?: string;
  messages: Message[];
  pendingApproval?: PendingApprovalState;
  turnStatus?: TurnStatus;
};
