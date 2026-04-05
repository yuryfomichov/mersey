import type { BeforeToolCallContext, HarnessPlugin, HookDecision } from '../../../harness/index.js';

export type BlockAndAskUser = (ctx: BeforeToolCallContext) => Promise<HookDecision> | HookDecision;

export type ToolApprovalPluginOptions = {
  blockAndAskUser: BlockAndAskUser;
  name?: string;
};

export function createAwaitableToolApprovalPlugin(options: ToolApprovalPluginOptions): HarnessPlugin {
  const pluginName = options.name ?? 'tool-approval';

  return {
    name: pluginName,
    beforeToolCall(ctx: BeforeToolCallContext): Promise<HookDecision> | HookDecision {
      return options.blockAndAskUser(ctx);
    },
  };
}
