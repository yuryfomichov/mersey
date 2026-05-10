import type { TurnContextContribution } from '../../runtime/context/types.js';
import type { TurnCommitContext, TurnContextCollectContext } from '../../runtime/plugins/types.js';

export type MemoryItem = {
  content: string;
  id: string;
  score?: number;
  source?: string;
  title?: string;
};

export type MemoryRecallContext = TurnContextCollectContext;

export type MemoryRememberContext = TurnCommitContext;

export type MemoryPluginOptions = {
  buildQuery?(ctx: MemoryRecallContext): string;
  formatMemories?(
    memories: MemoryItem[],
    ctx: MemoryRecallContext,
  ): TurnContextContribution[] | undefined | Promise<TurnContextContribution[] | undefined>;
  maxContextChars?: number;
  name?: string;
  recall(query: string, ctx: MemoryRecallContext): Promise<MemoryItem[]>;
  remember(ctx: MemoryRememberContext): Promise<void> | void;
  swallowRecallErrors?: boolean;
  topK?: number;
};
