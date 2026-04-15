import { randomUUID } from 'node:crypto';

import type { ModelProvider } from '../models/provider.js';
import type { ModelMessage, ModelRequest, ModelResponse, ModelToolCall, ModelToolDefinition } from '../models/types.js';
import type { ToolExecutionResult } from '../tools/types.js';
import { HarnessEventEmitter } from './emitter.js';
import {
  getDebugToolArgs,
  getResultDataKeys,
  getSafeToolArgs,
  sanitizeErrorMessage,
  sanitizeHookErrorMessage,
} from './telemetry.js';
import type { HarnessEventListener, HookErrorEvent, TurnFailedEvent } from './types.js';

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

export function getMessageCountsByRole(messages: readonly ModelMessage[]): {
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

    this.eventEmitter.publish({
      debug: this.debug,
      providerName: this.providerName,
      runId: this.runId,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      type: 'session_started',
    });
  }

  iterationStarted(iteration: number, messageCount: number): void {
    this.eventEmitter.publish({
      iteration,
      messageCount,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      turnId: this.getTurnId(),
      type: 'iteration_started',
    });
  }

  providerRequested(iteration: number, request: Readonly<ModelRequest>, provider: ProviderMetadata): void {
    const debugRequest = this.getDebugProviderRequest(request);

    this.eventEmitter.publish({
      ...(debugRequest ? { debugRequest } : {}),
      iteration,
      messageCount: request.messages.length,
      messageCountsByRole: getMessageCountsByRole(request.messages),
      model: provider.model,
      providerName: provider.name,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolDefinitionCount: request.tools?.length ?? 0,
      toolDefinitionNames: getToolDefinitionNames(request.tools),
      turnId: this.getTurnId(),
      type: 'provider_requested',
    });
  }

  providerResponded(iteration: number, provider: ProviderMetadata, response: ModelResponse, durationMs: number): void {
    const toolCallNames = getToolCallNames(response.toolCalls);
    const usedFallbackText = !response.text.trim() && !(response.toolCalls?.length ?? 0);

    this.eventEmitter.publish({
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
      usage: response.usage,
    });
  }

  toolFinished(iteration: number, toolCall: ModelToolCall, toolResult: ToolExecutionResult, durationMs: number): void {
    this.eventEmitter.publish({
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
  }

  toolRequested(iteration: number, toolCall: ModelToolCall): void {
    const debugArgs = getDebugToolArgs(toolCall.input, { debug: this.debug });

    this.eventEmitter.publish({
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
    this.eventEmitter.publish({
      iteration,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_started',
    });
  }

  toolBlocked(iteration: number, toolCall: ModelToolCall, reason: string, exposeToModel: boolean): void {
    this.eventEmitter.publish({
      exposeToModel,
      iteration,
      reason,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      turnId: this.getTurnId(),
      type: 'tool_blocked',
    });
  }

  providerBlocked(iteration: number, reason: string, exposeToModel: boolean): void {
    this.eventEmitter.publish({
      exposeToModel,
      iteration,
      reason,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      turnId: this.getTurnId(),
      type: 'provider_blocked',
    });
  }

  hookError(pluginName: string, hookName: HookErrorEvent['hookName'], error: unknown): void {
    this.eventEmitter.publish({
      errorMessage: sanitizeHookErrorMessage(error),
      hookName,
      pluginName,
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
      turnId: this.getTurnId(),
      type: 'hook_error',
    });
  }

  turnFailed(iteration: number, errorType: ErrorType, error: unknown): void {
    this.eventEmitter.publish({
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
    this.eventEmitter.publish({
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

    this.eventEmitter.publish({
      sessionId: this.getSessionId(),
      timestamp: new Date().toISOString(),
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

  private clearTurn(): void {
    this.currentTurnId = null;
    this.currentTurnStartTime = null;
  }

  private getDurationMs(): number {
    return Date.now() - this.getTurnStartTime();
  }

  private getDebugProviderRequest(request: Readonly<ModelRequest>):
    | {
        messages: ModelMessage[];
        stream: boolean;
        systemPrompt?: string;
        tools?: ModelToolDefinition[];
      }
    | undefined {
    if (!this.debug) {
      return undefined;
    }

    return {
      messages: request.messages.map(cloneModelMessage),
      stream: request.stream,
      ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
      ...(request.tools ? { tools: request.tools.map(cloneToolDefinition) } : {}),
    };
  }

  private getTurnStartTime(): number {
    if (!this.currentTurnStartTime) {
      this.currentTurnStartTime = Date.now();
    }

    return this.currentTurnStartTime;
  }
}

function cloneModelMessage(message: ModelMessage): ModelMessage {
  if (message.role === 'assistant') {
    return {
      ...message,
      ...(message.toolCalls
        ? {
            toolCalls: message.toolCalls.map((toolCall) => ({
              ...toolCall,
              input: sanitizeDebugValue(toolCall.input) as typeof toolCall.input,
            })),
          }
        : {}),
    };
  }

  if (message.role === 'tool') {
    return {
      ...message,
      ...(message.data ? { data: sanitizeDebugValue(message.data) as typeof message.data } : {}),
    };
  }

  return {
    ...message,
  };
}

function cloneToolDefinition(tool: ModelToolDefinition): ModelToolDefinition {
  return {
    ...tool,
    inputSchema: sanitizeDebugValue(tool.inputSchema) as ModelToolDefinition['inputSchema'],
  };
}

function sanitizeDebugValue(value: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'undefined') {
    return '[undefined]';
  }

  if (typeof value === 'function' || typeof value === 'symbol') {
    return `[${typeof value}]`;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof RegExp) {
    return value.toString();
  }

  if (seen.has(value)) {
    return '[circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDebugValue(entry, seen));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = sanitizeDebugValue(nestedValue, seen);
  }

  return sanitized;
}
