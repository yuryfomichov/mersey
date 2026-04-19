import type {
  PrepareProviderRequestContext,
  PrepareProviderRequestMessage,
  PrepareProviderRequestResult,
  PrepareProviderRequestUserMessage,
} from '../../runtime/plugins/types.js';
import type { Message } from '../../runtime/sessions/types.js';

export type MemoryItem = {
  content: string;
  id: string;
  score?: number;
  source?: string;
  title?: string;
};

export type MemoryRecallContext = {
  model: string;
  providerName: string;
  sessionId: string;
  signal?: AbortSignal;
  transcript: readonly Readonly<PrepareProviderRequestMessage>[];
  turnId: string;
  userMessage: Readonly<PrepareProviderRequestUserMessage>;
};

export type MemoryRememberContext = {
  historyBeforeTurn: readonly Message[];
  model: string;
  sessionId: string;
  turnId: string;
  turnMessages: readonly Message[];
};

export type MemoryPluginOptions = {
  buildQuery?(ctx: MemoryRecallContext): string;
  formatMemories?(
    memories: MemoryItem[],
    ctx: MemoryRecallContext,
  ): PrepareProviderRequestResult | undefined | Promise<PrepareProviderRequestResult | undefined>;
  maxContextChars?: number;
  name?: string;
  recall(query: string, ctx: MemoryRecallContext): Promise<MemoryItem[]>;
  remember(ctx: MemoryRememberContext): Promise<void> | void;
  swallowRecallErrors?: boolean;
  topK?: number;
};

export function toMemoryRecallContext(ctx: PrepareProviderRequestContext): MemoryRecallContext {
  return {
    model: ctx.model,
    providerName: ctx.providerName,
    sessionId: ctx.sessionId,
    signal: ctx.signal,
    transcript: ctx.transcript,
    turnId: ctx.turnId,
    userMessage: ctx.userMessage,
  };
}
