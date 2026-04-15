import type { PrepareProviderRequestContext, PrepareProviderRequestResult } from '../../runtime/plugins/types.js';

export type RetrievedChunk = {
  content: string;
  id: string;
  score?: number;
  source?: string;
  title?: string;
};

export type RetrievalPluginOptions = {
  buildQuery?(ctx: PrepareProviderRequestContext): string;
  formatChunks?(
    chunks: RetrievedChunk[],
    ctx: PrepareProviderRequestContext,
  ): PrepareProviderRequestResult | Promise<PrepareProviderRequestResult>;
  maxContextChars?: number;
  name?: string;
  retrieve(query: string, ctx: PrepareProviderRequestContext): Promise<RetrievedChunk[]>;
  topK?: number;
};
