import type { BeforeToolExecutionContext, HarnessPlugin, HookDecision } from '../../../harness/types.js';

export type BlockAndAskUser = (ctx: BeforeToolExecutionContext) => Promise<HookDecision> | HookDecision;

export type ToolApprovalPluginOptions = {
  blockAndAskUser: BlockAndAskUser;
  name?: string;
};

export function createAwaitableToolApprovalPlugin(options: ToolApprovalPluginOptions): HarnessPlugin {
  const pluginName = options.name ?? 'tool-approval';

  return {
    name: pluginName,
    beforeToolExecution(ctx: BeforeToolExecutionContext): Promise<HookDecision> | HookDecision {
      return options.blockAndAskUser(ctx);
    },
  };
}
