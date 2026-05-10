import type { NormalizedTurnContext, TurnContextContribution } from '../context/types.js';
import type { HarnessEvent } from '../events/types.js';
import type { ModelProvider } from '../models/provider.js';
import type { ModelMessage, ModelToolDefinition } from '../models/types.js';
import type { Message } from '../sessions/types.js';
import type { ResolvedToolCall } from '../tools/catalog.js';

export type HookDecision =
  | { continue: true }
  | {
      continue: false;
      reason: string;
      exposeToModel?: boolean;
    };

export type HookName = 'beforeProviderCall' | 'beforeToolExecution' | 'onEvent';

export type ProviderRequestSnapshot = Readonly<{
  context?: NormalizedTurnContext;
  messages: readonly Readonly<ModelMessage>[];
  stream: boolean;
  systemPrompt?: string;
  tools?: readonly Readonly<ModelToolDefinition>[];
}>;

export type BeforeProviderCallContext = {
  iteration: number;
  messageCount: number;
  messageCountsByRole: { assistant: number; tool: number; user: number };
  model: string;
  providerName: string;
  request: ProviderRequestSnapshot;
  sessionId: string;
  toolDefinitionNames: string[];
  turnId: string;
};

export type TurnContextCollectContext = {
  iteration: number;
  model: string;
  providerName: string;
  sessionId: string;
  signal?: AbortSignal;
  transcript: readonly Readonly<Message>[];
  turnId: string;
  userMessage: Readonly<{
    content: string;
    role: 'user';
  }>;
};

export interface TurnContextCollector {
  priority?: number;

  collect(ctx: TurnContextCollectContext): Promise<TurnContextContribution[]>;
}

export type TurnCommitContext = {
  historyBeforeTurn: readonly Message[];
  model: string;
  provider: ModelProvider;
  providerName: string;
  sessionId: string;
  turnId: string;
  turnMessages: readonly Message[];
};

export interface TurnCommitObserver {
  afterTurnCommitted(ctx: TurnCommitContext): Promise<void>;
}

export type BeforeToolExecutionContext = {
  iteration: number;
  sessionId: string;
  tool: ResolvedToolCall;
  turnId: string;
};

export type PluginEventContext = {
  pluginName: string;
  runId: string;
  sessionId: string;
  turnId?: string;
};

export type HarnessPlugin = {
  name: string;

  beforeProviderCall?(ctx: BeforeProviderCallContext): Promise<HookDecision> | HookDecision;
  beforeToolExecution?(ctx: BeforeToolExecutionContext): Promise<HookDecision> | HookDecision;
  onEvent?(event: HarnessEvent, ctx: PluginEventContext): Promise<void> | void;
};

export function isHookDecision(value: unknown): value is HookDecision {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }

  if ('continue' in value && value.continue === true) {
    return true;
  }

  return 'continue' in value && value.continue === false && 'reason' in value;
}
