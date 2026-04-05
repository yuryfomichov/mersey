import type { BeforeToolCallContext, HarnessPlugin, HookDecision } from '../../../harness/index.js';

export type ToolApprovalDecision = 'approved' | 'denied' | 'pending';

export type ToolApprovalState = {
  decision: ToolApprovalDecision;
  toolName: string;
  toolCallId: string;
};

export function createAwaitableToolApprovalPlugin(
  state: ToolApprovalState,
  pollIntervalMs: number = 1000,
  timeoutMs: number = 60000,
): HarnessPlugin {
  return {
    name: 'tool-approval',
    async beforeToolCall(ctx: BeforeToolCallContext): Promise<HookDecision> {
      const currentDecision = state.decision;

      if (currentDecision === 'approved' && state.toolCallId === ctx.toolCall.id) {
        state.decision = 'pending';
        state.toolCallId = '';
        return { continue: true };
      }

      if (currentDecision === 'denied' && state.toolCallId === ctx.toolCall.id) {
        state.decision = 'pending';
        state.toolCallId = '';
        return {
          continue: false,
          reason: 'Tool call denied by user.',
          exposeToModel: true,
        };
      }

      state.decision = 'pending';
      state.toolName = ctx.toolCall.name;
      state.toolCallId = ctx.toolCall.id;

      const start = Date.now();

      while (state.decision === 'pending' && state.toolCallId === ctx.toolCall.id) {
        if (Date.now() - start > timeoutMs) {
          state.decision = 'denied';
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      const result = state.decision as ToolApprovalDecision;
      state.decision = 'pending';
      state.toolCallId = '';

      if (result === 'approved') {
        return { continue: true };
      }

      return {
        continue: false,
        reason: result === 'denied' ? 'Tool call denied by user.' : 'Tool call timed out.',
        exposeToModel: true,
      };
    },
  };
}
