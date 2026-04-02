import type { ModelToolCall } from '../models/types.js';
import type { AssistantMessage, Message } from '../sessions/types.js';

export type ToolCallAction = 'auto_allow' | 'require_approval';

export type ToolCallPolicy = {
  action: ToolCallAction;
  type: 'fixed';
};

export type PendingApproval = {
  assistantMessage: AssistantMessage;
  requiredToolCallIds: string[];
  toolIterations: number;
  totalToolCalls: number;
  turnId: string;
};

export type ApprovalDecision = {
  toolCallId: string;
  type: 'approve' | 'deny';
};

export type ApprovalResult = Message | PendingApproval;

export function requiresApproval(
  toolCall: Pick<ModelToolCall, 'id'>,
  pendingApproval: Pick<PendingApproval, 'requiredToolCallIds'>,
): boolean {
  return pendingApproval.requiredToolCallIds.includes(toolCall.id);
}
