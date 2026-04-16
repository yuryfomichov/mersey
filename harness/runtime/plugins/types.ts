import type { HarnessEvent } from '../events/types.js';
import type { ModelProvider } from '../models/provider.js';
import type { ModelMessage, ModelRequest } from '../models/types.js';
import type { Message } from '../sessions/types.js';

export type HookDecision =
  | { continue: true }
  | {
      continue: false;
      reason: string;
      exposeToModel?: boolean;
    };

export type HookName =
  | 'beforeProviderCall'
  | 'prepareProviderRequest'
  | 'beforeToolCall'
  | 'afterTurnCommitted'
  | 'onEvent';

export type BeforeProviderCallContext = {
  sessionId: string;
  turnId: string;
  iteration: number;
  providerName: string;
  model: string;
  messageCount: number;
  messageCountsByRole: { user: number; assistant: number; tool: number };
  toolDefinitionNames: string[];
};

export type PrepareProviderRequestMessage =
  | {
      content: string;
      role: 'user';
    }
  | {
      content: string;
      role: 'assistant';
    }
  | {
      content: string;
      isError?: boolean;
      name: string;
      role: 'tool';
      toolCallId: string;
    };

export type PrepareProviderRequestUserMessage = {
  content: string;
  role: 'user';
};

export type PrepareProviderRequestContext = {
  sessionId: string;
  turnId: string;
  iteration: number;
  providerName: string;
  model: string;
  transcript: readonly Readonly<PrepareProviderRequestMessage>[];
  userMessage: Readonly<PrepareProviderRequestUserMessage>;
  signal?: AbortSignal;
};

export type PrepareProviderRequestResult = {
  appendMessages?: ModelMessage[];
  messages?: ModelMessage[];
  prependMessages?: ModelMessage[];
  systemPrompt?: string;
};

export type BeforeToolCallContext = {
  sessionId: string;
  turnId: string;
  iteration: number;
  toolCall: {
    id: string;
    name: string;
    input: unknown;
  };
};

export type AfterTurnCommittedContext = {
  historyBeforeTurn: readonly Message[];
  model: string;
  provider: ModelProvider;
  providerName: string;
  sessionId: string;
  turnId: string;
  turnMessages: readonly Message[];
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
  prepareProviderRequest?(
    request: Readonly<ModelRequest>,
    ctx: PrepareProviderRequestContext,
  ): Promise<PrepareProviderRequestResult> | PrepareProviderRequestResult;
  beforeToolCall?(ctx: BeforeToolCallContext): Promise<HookDecision> | HookDecision;
  afterTurnCommitted?(ctx: AfterTurnCommittedContext): Promise<void> | void;

  onEvent?(event: HarnessEvent, ctx: PluginEventContext): Promise<void> | void;
};

export function isHookDecision(value: unknown): value is HookDecision {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  if ('continue' in value && value.continue === true) {
    return true;
  }

  if ('continue' in value && value.continue === false && 'reason' in value) {
    return true;
  }

  return false;
}
