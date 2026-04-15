import type { HarnessEvent } from '../events/types.js';
import type { ModelMessage, ModelRequest } from '../models/types.js';
import type { Message } from '../sessions/types.js';

export type HookDecision =
  | { continue: true }
  | {
      continue: false;
      reason: string;
      exposeToModel?: boolean;
    };

export type HookName = 'beforeProviderCall' | 'prepareProviderRequest' | 'beforeToolCall' | 'onEvent';

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

export type PrepareProviderRequestContext = {
  sessionId: string;
  turnId: string;
  iteration: number;
  providerName: string;
  model: string;
  transcript: readonly Readonly<Message>[];
  userMessage: Readonly<Message>;
  signal?: AbortSignal;
};

export type PrepareProviderRequestResult = {
  appendMessages?: ModelMessage[];
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
    request: ModelRequest,
    ctx: PrepareProviderRequestContext,
  ): Promise<PrepareProviderRequestResult> | PrepareProviderRequestResult;
  beforeToolCall?(ctx: BeforeToolCallContext): Promise<HookDecision> | HookDecision;

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
