import { randomUUID } from 'node:crypto';

import type { ModelProvider } from '../models/provider.js';
import type { ModelResponse, ModelToolCall, ModelToolDefinition } from '../models/types.js';
import type { Message } from '../sessions/types.js';
import type { ToolExecutionResult } from '../tools/types.js';
import { HarnessEventEmitter } from './emitter.js';
import {
  getDebugToolArgs,
  getResultDataKeys,
  getSafeToolArgs,
  sanitizeErrorMessage,
  sanitizeHookErrorMessage,
} from './telemetry.js';
import type { HarnessEvent, HarnessEventListener, HookErrorEvent, TurnFailedEvent } from './types.js';

export type HarnessEventReporterOptions = {
  debug?: boolean;
  eventEmitter?: HarnessEventEmitter;
  getSessionId: () => string;
  providerName: string;
};

type ErrorType = TurnFailedEvent['errorType'];
type ProviderMetadata = Pick<ModelProvider, 'model' | 'name'>;

function getToolCallNames(toolCalls: { name: string }[] | undefined): string[] {
  return toolCalls?.map((toolCall) => toolCall.name) ?? [];
}

function getToolDefinitionNames(toolDefinitions: ModelToolDefinition[] | undefined): string[] {
  return toolDefinitions?.map((tool) => tool.name) ?? [];
}

export function getMessageCountsByRole(messages: readonly Message[]): {
  assistant: number;
  tool: number;
  user: number;
} {
  return messages.reduce(
    (counts, message) => {
      counts[message.role] += 1;
      return counts;
    },
    { assistant: 0, tool: 0, user: 0 },
  );
}

export class HarnessEventReporter {
  private readonly debug: boolean;
  readonly getSessionId: () => string;
  private readonly providerName: string;
  private readonly runId = randomUUID();
  private readonly eventEmitter: HarnessEventEmitter;
  private hasStartedSession = false;
  private currentTurnId: string | null = null;
  private currentTurnStartTime: number | null = null;

  constructor({ debug, eventEmitter, getSessionId, providerName }: HarnessEventReporterOptions) {
    this.debug = Boolean(debug);
    this.eventEmitter = eventEmitter ?? new HarnessEventEmitter();
    this.getSessionId = getSessionId;
    this.providerName = providerName;
  }

  sessionStarted(): void {
    if (this.hasStartedSession) {
      return;
    }

    this.hasStartedSession = true;

    this.dispatchEvent({
      debug: this.debug,
      providerName: this.providerName,
      runId: this.runId,
      type: 'session_started',
    });
  }

  iterationStarted(iteration: number, messageCount: number): void {
    this.dispatchEvent({
      iteration,
      messageCount,
      turnId: this.getTurnId(),
      type: 'iteration_started',
    });
  }

  providerRequested(
    iteration: number,
    messages: Message[],
    provider: ProviderMetadata,
    toolDefinitions: ModelToolDefinition[] | undefined,
  ): void {
    this.dispatchEvent({
      iteration,
      messageCount: messages.length,
      messageCountsByRole: getMessageCountsByRole(messages),
      model: provider.model,
      providerName: provider.name,
      toolDefinitionCount: toolDefinitions?.length ?? 0,
      toolDefinitionNames: getToolDefinitionNames(toolDefinitions),
      turnId: this.getTurnId(),
      type: 'provider_requested',
    });
  }

  providerResponded(iteration: number, provider: ProviderMetadata, response: ModelResponse, durationMs: number): void {
    const toolCallNames = getToolCallNames(response.toolCalls);
    const usedFallbackText = !response.text.trim() && !(response.toolCalls?.length ?? 0);

    this.dispatchEvent({
      durationMs,
      iteration,
      model: provider.model,
      providerName: provider.name,
      textLength: response.text.length,
      toolCallCount: response.toolCalls?.length ?? 0,
      toolCallNames,
      turnId: this.getTurnId(),
      type: 'provider_responded',
      usedFallbackText,
      usage: response.usage,
    });
  }

  toolFinished(iteration: number, toolCall: ModelToolCall, toolResult: ToolExecutionResult, durationMs: number): void {
    this.dispatchEvent({
      durationMs,
      isError: Boolean(toolResult.isError),
      iteration,
      resultContentLength: toolResult.content.length,
      resultDataKeys: getResultDataKeys(toolResult.data),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_finished',
    });
  }

  toolRequested(iteration: number, toolCall: ModelToolCall): void {
    const debugArgs = getDebugToolArgs(toolCall.input, { debug: this.debug });

    this.dispatchEvent({
      ...(debugArgs ? { debugArgs } : {}),
      iteration,
      safeArgs: getSafeToolArgs(toolCall.input),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_requested',
    });
  }

  toolStarted(iteration: number, toolCall: ModelToolCall): void {
    this.dispatchEvent({
      iteration,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_started',
    });
  }

  toolBlocked(iteration: number, toolCall: ModelToolCall, reason: string, exposeToModel: boolean): void {
    this.dispatchEvent({
      exposeToModel,
      iteration,
      reason,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_blocked',
    });
  }

  providerBlocked(iteration: number, reason: string, exposeToModel: boolean): void {
    this.dispatchEvent({
      exposeToModel,
      iteration,
      reason,
      turnId: this.getTurnId(),
      type: 'provider_blocked',
    });
  }

  hookError(pluginName: string, hookName: HookErrorEvent['hookName'], error: unknown): void {
    void error;

    this.dispatchEvent({
      errorMessage: sanitizeHookErrorMessage(),
      hookName,
      pluginName,
      turnId: this.getTurnId(),
      type: 'hook_error',
    });
  }

  turnFailed(iteration: number, errorType: ErrorType, error: unknown): void {
    this.dispatchEvent({
      durationMs: this.getDurationMs(),
      errorMessage: sanitizeErrorMessage(errorType, error),
      errorType,
      iteration,
      turnId: this.getTurnId(),
      type: 'turn_failed',
    });

    this.clearTurn();
  }

  turnFinished(totalIterations: number, totalToolCalls: number, finalAssistantLength: number): void {
    this.dispatchEvent({
      durationMs: this.getDurationMs(),
      finalAssistantLength,
      totalIterations,
      totalToolCalls,
      turnId: this.getTurnId(),
      type: 'turn_finished',
    });

    this.clearTurn();
  }

  turnStarted(userMessageLength: number): void {
    this.currentTurnId = randomUUID();
    this.currentTurnStartTime = Date.now();

    this.dispatchEvent({
      turnId: this.getTurnId(),
      type: 'turn_started',
      userMessageLength,
    });
  }

  subscribe(listener: HarnessEventListener): () => void {
    return this.eventEmitter.subscribe(listener);
  }

  getRunId(): string {
    return this.runId;
  }

  getTurnId(): string {
    if (!this.currentTurnId) {
      this.currentTurnId = randomUUID();
    }

    return this.currentTurnId;
  }

  private dispatchEvent(event: { type: HarnessEvent['type'] } & Record<string, unknown>): void {
    this.eventEmitter.publish({
      ...event,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
    } as HarnessEvent);
  }

  private clearTurn(): void {
    this.currentTurnId = null;
    this.currentTurnStartTime = null;
  }

  private getDurationMs(): number {
    return Date.now() - this.getTurnStartTime();
  }

  private getTurnStartTime(): number {
    if (!this.currentTurnStartTime) {
      this.currentTurnStartTime = Date.now();
    }

    return this.currentTurnStartTime;
  }
}
