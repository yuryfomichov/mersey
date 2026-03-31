import { randomUUID } from 'node:crypto';

import type { HarnessEvent, TurnFailedEvent } from './events/index.js';
import { emitRuntimeTrace, type HarnessLogger } from './logger/index.js';
import type { ModelProvider, ModelResponse, ModelToolCall, ModelToolDefinition } from './models/index.js';
import type { Message } from './sessions/index.js';
import type { ToolExecutionResult } from './tools/index.js';
import { getDebugToolArgs, getResultDataKeys, getSafeToolArgs, sanitizeErrorMessage } from './telemetry.js';

type LoopObserverInput = {
  debug?: boolean;
  emitEvent?: (event: HarnessEvent) => void;
  logger?: HarnessLogger;
  provider: ModelProvider;
  sessionId: string;
  toolDefinitions: ModelToolDefinition[] | undefined;
};

type ErrorType = TurnFailedEvent['errorType'];

export type LoopObserver = {
  iterationStarted(iteration: number, messageCount: number): void;
  providerRequested(iteration: number, messages: Message[]): void;
  providerResponded(iteration: number, response: ModelResponse, durationMs: number): void;
  toolFinished(iteration: number, toolCall: ModelToolCall, toolResult: ToolExecutionResult, durationMs: number): void;
  toolRequested(iteration: number, toolCall: ModelToolCall): void;
  toolStarted(iteration: number, toolCall: ModelToolCall): void;
  turnFailed(iteration: number, errorType: ErrorType, error: unknown): void;
  turnFinished(totalIterations: number, totalToolCalls: number, finalAssistantLength: number): void;
  turnStarted(userMessageLength: number): void;
};

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

export function createLoopObserver({ debug, emitEvent, logger, provider, sessionId, toolDefinitions }: LoopObserverInput): LoopObserver {
  const turnId = randomUUID();
  const turnStartTime = Date.now();

  const publishEvent = (event: HarnessEvent): void => {
    if (!emitEvent) {
      return;
    }

    try {
      emitEvent(event);
    } catch {
      emitRuntimeTrace(logger, 'event_delivery_failed', {
        eventType: event.type,
        sessionId,
        turnId,
      });
    }
  };

  const getDurationMs = (startTime: number): number => Date.now() - startTime;

  const getToolDefinitionNames = (): string[] => toolDefinitions?.map((tool) => tool.name) ?? [];

  const emitToolTrace = (type: string, iteration: number, toolCall: ModelToolCall, detail: Record<string, unknown>): void => {
    const debugArgs = getDebugToolArgs(toolCall.input, { debug });

    emitRuntimeTrace(logger, type, {
      ...(debugArgs ? { debugArgs } : {}),
      iteration,
      safeArgs: getSafeToolArgs(toolCall.input),
      sessionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId,
      ...detail,
    });
  };

  return {
    iterationStarted(iteration: number, messageCount: number): void {
      emitRuntimeTrace(logger, 'loop_iteration_started', {
        iteration,
        messageCount,
        sessionId,
        turnId,
      });
    },

    providerRequested(iteration: number, messages: Message[]): void {
      publishEvent({
        id: randomUUID(),
        iteration,
        messageCount: messages.length,
        messageCountsByRole: getMessageCountsByRole(messages),
        model: provider.model,
        providerName: provider.name,
        sessionId,
        timestamp: new Date().toISOString(),
        toolDefinitionCount: toolDefinitions?.length ?? 0,
        toolDefinitionNames: getToolDefinitionNames(),
        turnId,
        type: 'provider_requested',
      });

      emitRuntimeTrace(logger, 'provider_request_started', {
        iteration,
        model: provider.model,
        providerName: provider.name,
        sessionId,
        turnId,
      });
    },

    providerResponded(iteration: number, response: ModelResponse, durationMs: number): void {
      const toolCallNames = getToolCallNames(response.toolCalls);
      const usedFallbackText = !response.text.trim() && !(response.toolCalls?.length ?? 0);

      publishEvent({
        durationMs,
        id: randomUUID(),
        iteration,
        model: provider.model,
        providerName: provider.name,
        sessionId,
        textLength: response.text.length,
        timestamp: new Date().toISOString(),
        toolCallCount: response.toolCalls?.length ?? 0,
        toolCallNames,
        turnId,
        type: 'provider_responded',
        usedFallbackText,
      });

      emitRuntimeTrace(logger, 'provider_response_finished', {
        durationMs,
        iteration,
        model: provider.model,
        providerName: provider.name,
        sessionId,
        textLength: response.text.length,
        toolCallCount: response.toolCalls?.length ?? 0,
        turnId,
        usedFallbackText,
      });
    },

    toolFinished(iteration: number, toolCall: ModelToolCall, toolResult: ToolExecutionResult, durationMs: number): void {
      publishEvent({
        durationMs,
        id: randomUUID(),
        isError: Boolean(toolResult.isError),
        iteration,
        resultContentLength: toolResult.content.length,
        resultDataKeys: getResultDataKeys(toolResult.data),
        sessionId,
        timestamp: new Date().toISOString(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        turnId,
        type: 'tool_finished',
      });

      emitToolTrace('tool_execution_finished', iteration, toolCall, {
        durationMs,
        isError: Boolean(toolResult.isError),
        resultContentLength: toolResult.content.length,
        resultDataKeys: getResultDataKeys(toolResult.data),
      });
    },

    toolRequested(iteration: number, toolCall: ModelToolCall): void {
      const debugArgs = getDebugToolArgs(toolCall.input, { debug });

      publishEvent({
        ...(debugArgs ? { debugArgs } : {}),
        id: randomUUID(),
        iteration,
        safeArgs: getSafeToolArgs(toolCall.input),
        sessionId,
        timestamp: new Date().toISOString(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        turnId,
        type: 'tool_requested',
      });
    },

    toolStarted(iteration: number, toolCall: ModelToolCall): void {
      publishEvent({
        id: randomUUID(),
        iteration,
        sessionId,
        timestamp: new Date().toISOString(),
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        turnId,
        type: 'tool_started',
      });

      emitToolTrace('tool_execution_started', iteration, toolCall, {});
    },

    turnFailed(iteration: number, errorType: ErrorType, error: unknown): void {
      publishEvent({
        durationMs: getDurationMs(turnStartTime),
        errorMessage: sanitizeErrorMessage(errorType, error),
        errorType,
        id: randomUUID(),
        iteration,
        sessionId,
        timestamp: new Date().toISOString(),
        turnId,
        type: 'turn_failed',
      });
    },

    turnFinished(totalIterations: number, totalToolCalls: number, finalAssistantLength: number): void {
      publishEvent({
        durationMs: getDurationMs(turnStartTime),
        finalAssistantLength,
        id: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        totalIterations,
        totalToolCalls,
        turnId,
        type: 'turn_finished',
      });
    },

    turnStarted(userMessageLength: number): void {
      publishEvent({
        id: randomUUID(),
        sessionId,
        timestamp: new Date().toISOString(),
        turnId,
        type: 'turn_started',
        userMessageLength,
      });
    },
  };
}
