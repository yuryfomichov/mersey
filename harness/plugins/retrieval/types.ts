import type { TurnContextContribution } from '../../runtime/context/types.js';
import type { TurnContextCollectContext } from '../../runtime/plugins/types.js';

export type RetrievedChunk = {
  content: string;
  id: string;
  score?: number;
  source?: string;
  title?: string;
};

export type RetrievalPluginOptions = {
  buildQuery?(ctx: TurnContextCollectContext): string;
  formatChunks?(
    chunks: RetrievedChunk[],
    ctx: TurnContextCollectContext,
  ): TurnContextContribution[] | undefined | Promise<TurnContextContribution[] | undefined>;
  maxContextChars?: number;
  name?: string;
  retrieve(query: string, ctx: TurnContextCollectContext): Promise<RetrievedChunk[]>;
  topK?: number;
};
