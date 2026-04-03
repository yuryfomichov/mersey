import { randomUUID } from 'node:crypto';

import { emitRuntimeTrace } from '../logger/runtime-trace.js';
import type { HarnessLogger, HarnessRuntimeTraceType } from '../logger/types.js';
import type { ModelProvider } from '../models/provider.js';
import type { ModelResponse, ModelToolCall, ModelToolDefinition } from '../models/types.js';
import type { Message } from '../sessions/types.js';
import type { ToolExecutionResult } from '../tools/types.js';
import { HarnessEventPublisher } from './publisher.js';
import { getDebugToolArgs, getResultDataKeys, getSafeToolArgs, sanitizeErrorMessage } from './telemetry.js';
import type { HarnessEvent, HarnessEventListener, TurnFailedEvent } from './types.js';

export type HarnessObserverOptions = {
  debug?: boolean;
  getSessionId: () => string;
  logger?: HarnessLogger;
  providerName: string;
};

type ErrorType = TurnFailedEvent['errorType'];
type ProviderMetadata = Pick<ModelProvider, 'model' | 'name'>;

function getMessageCountsByRole(messages: Message[]): {
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

function getToolCallNames(toolCalls: { name: string }[] | undefined): string[] {
  return toolCalls?.map((toolCall) => toolCall.name) ?? [];
}

function getToolDefinitionNames(toolDefinitions: ModelToolDefinition[] | undefined): string[] {
  return toolDefinitions?.map((tool) => tool.name) ?? [];
}

export class HarnessObserver {
  private readonly debug: boolean;
  private readonly getSessionId: () => string;
  private readonly logger: HarnessLogger | undefined;
  private readonly providerName: string;
  private readonly runId = randomUUID();
  private readonly eventPublisher: HarnessEventPublisher;
  private hasStartedSession = false;
  private currentTurnId: string | null = null;
  private currentTurnStartTime: number | null = null;

  constructor({ debug, getSessionId, logger, providerName }: HarnessObserverOptions) {
    this.debug = Boolean(debug);
    this.getSessionId = getSessionId;
    this.logger = logger;
    this.providerName = providerName;
    const publisherOptions = this.logger
      ? {
          onEventPublished: (event: HarnessEvent) => {
            this.emitTrace('event_emitted', {
              eventType: event.type,
              sessionId: event.sessionId,
              turnId: event.turnId,
            });
          },
          onListenerFailed: (event: HarnessEvent) => {
            this.emitTrace('listener_failed', {
              eventType: event.type,
            });
          },
        }
      : {};

    this.eventPublisher = new HarnessEventPublisher(publisherOptions);
  }

  sessionStarted(): void {
    if (this.hasStartedSession) {
      return;
    }

    this.hasStartedSession = true;

    this.emitTrace('session_started', {
      debug: this.debug,
      provider: this.providerName,
      runId: this.runId,
      sessionId: this.getSessionId(),
    });
  }

  iterationStarted(iteration: number, messageCount: number): void {
    this.emitTrace('loop_iteration_started', {
      iteration,
      messageCount,
      sessionId: this.getSessionId(),
      turnId: this.getTurnId(),
    });
  }

  providerRequested(
    iteration: number,
    messages: Message[],
    provider: ProviderMetadata,
    toolDefinitions: ModelToolDefinition[] | undefined,
  ): void {
    this.publishEvent({
      iteration,
      messageCount: messages.length,
      messageCountsByRole: getMessageCountsByRole(messages),
      model: provider.model,
      providerName: provider.name,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolDefinitionCount: toolDefinitions?.length ?? 0,
      toolDefinitionNames: getToolDefinitionNames(toolDefinitions),
      turnId: this.getTurnId(),
      type: 'provider_requested',
    });

    this.emitTrace('provider_request_started', {
      iteration,
      model: provider.model,
      providerName: provider.name,
      sessionId: this.getSessionId(),
      turnId: this.getTurnId(),
    });
  }

  providerResponded(iteration: number, provider: ProviderMetadata, response: ModelResponse, durationMs: number): void {
    const toolCallNames = getToolCallNames(response.toolCalls);
    const usedFallbackText = !response.text.trim() && !(response.toolCalls?.length ?? 0);

    this.publishEvent({
      durationMs,
      iteration,
      model: provider.model,
      providerName: provider.name,
      sessionId: this.getSessionId(),
      textLength: response.text.length,
      timestamp: new Date().toISOString(),
      toolCallCount: response.toolCalls?.length ?? 0,
      toolCallNames,
      turnId: this.getTurnId(),
      type: 'provider_responded',
      usedFallbackText,
    });

    this.emitTrace('provider_response_finished', {
      durationMs,
      iteration,
      model: provider.model,
      providerName: provider.name,
      sessionId: this.getSessionId(),
      textLength: response.text.length,
      toolCallCount: response.toolCalls?.length ?? 0,
      turnId: this.getTurnId(),
      usedFallbackText,
    });
  }

  toolFinished(iteration: number, toolCall: ModelToolCall, toolResult: ToolExecutionResult, durationMs: number): void {
    this.publishEvent({
      durationMs,
      isError: Boolean(toolResult.isError),
      iteration,
      resultContentLength: toolResult.content.length,
      resultDataKeys: getResultDataKeys(toolResult.data),
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_finished',
    });

    this.emitToolTrace('tool_execution_finished', iteration, toolCall, {
      durationMs,
      isError: Boolean(toolResult.isError),
      resultContentLength: toolResult.content.length,
      resultDataKeys: getResultDataKeys(toolResult.data),
    });
  }

  toolRequested(iteration: number, toolCall: ModelToolCall): void {
    const debugArgs = getDebugToolArgs(toolCall.input, { debug: this.debug });

    this.publishEvent({
      ...(debugArgs ? { debugArgs } : {}),
      iteration,
      safeArgs: getSafeToolArgs(toolCall.input),
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_requested',
    });
  }

  toolStarted(iteration: number, toolCall: ModelToolCall): void {
    this.publishEvent({
      iteration,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_started',
    });

    this.emitToolTrace('tool_execution_started', iteration, toolCall, {});
  }

  turnFailed(iteration: number, errorType: ErrorType, error: unknown): void {
    this.publishEvent({
      durationMs: this.getDurationMs(),
      errorMessage: sanitizeErrorMessage(errorType, error),
      errorType,
      iteration,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      turnId: this.getTurnId(),
      type: 'turn_failed',
    });

    this.clearTurn();
  }

  turnFinished(totalIterations: number, totalToolCalls: number, finalAssistantLength: number): void {
    this.publishEvent({
      durationMs: this.getDurationMs(),
      finalAssistantLength,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
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

    this.publishEvent({
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      turnId: this.getTurnId(),
      type: 'turn_started',
      userMessageLength,
    });
  }

  subscribe(listener: HarnessEventListener): () => void {
    return this.eventPublisher.subscribe(listener);
  }

  private clearTurn(): void {
    this.currentTurnId = null;
    this.currentTurnStartTime = null;
  }

  private emitToolTrace(
    type: HarnessRuntimeTraceType,
    iteration: number,
    toolCall: ModelToolCall,
    detail: Record<string, unknown>,
  ): void {
    const debugArgs = getDebugToolArgs(toolCall.input, { debug: this.debug });

    this.emitTrace(type, {
      ...(debugArgs ? { debugArgs } : {}),
      iteration,
      safeArgs: getSafeToolArgs(toolCall.input),
      sessionId: this.getSessionId(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      ...detail,
    });
  }

  private emitTrace(type: HarnessRuntimeTraceType, detail: Record<string, unknown>): void {
    emitRuntimeTrace(this.logger, type, detail);
  }

  private getDurationMs(): number {
    return Date.now() - this.getTurnStartTime();
  }

  private getTurnId(): string {
    if (!this.currentTurnId) {
      this.currentTurnId = randomUUID();
    }

    return this.currentTurnId;
  }

  private getTurnStartTime(): number {
    if (!this.currentTurnStartTime) {
      this.currentTurnStartTime = Date.now();
    }

    return this.currentTurnStartTime;
  }

  private publishEvent(event: HarnessEvent): void {
    try {
      this.eventPublisher.publish(event);
    } catch {
      this.emitTrace('event_delivery_failed', {
        eventType: event.type,
        sessionId: this.getSessionId(),
        turnId: this.getTurnId(),
      });
    }
  }
}
