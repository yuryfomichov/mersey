import { randomUUID } from 'node:crypto';

import type { HarnessEvent } from './events/index.js';
import type { HarnessLogger } from './logger/index.js';
import { createLoopObserver } from './loop-observer.js';
import type { ModelMessage, ModelProvider, ModelRequest, ModelResponse, ModelToolCall } from './models/index.js';
import { supportsStreaming } from './models/index.js';
import type { SessionStore } from './sessions/index.js';
import { applySessionStatePatch } from './sessions/index.js';
import type { Message, Session, SessionStatePatch } from './sessions/index.js';
import { getCurrentTurnProgress } from './turn-state.js';
import { createToolContext, executeToolCall, getToolDefinitions, getToolMap } from './tools/index.js';
import type { Tool, ToolApprovalRequirement, ToolPolicy } from './tools/index.js';

export type RunLoopOptions = {
  maxToolIterations?: number;
};

export type RunLoopInput = {
  content?: string;
  debug?: boolean;
  emitEvent?: (event: HarnessEvent) => void;
  logger?: HarnessLogger;
  options?: RunLoopOptions;
  provider: ModelProvider;
  resumeAfterToolCallId?: string;
  signal?: AbortSignal;
  session: Session;
  sessionStore: SessionStore;
  startContent?: string;
  stream?: boolean;
  systemPrompt?: string;
  turnId?: string;
  toolPolicy: ToolPolicy;
  tools: Tool[];
};

export type TurnChunk =
  | {
      delta: string;
      type: 'assistant_delta';
    }
  | {
      type: 'assistant_message_completed';
    }
  | {
      approval: {
        input: Record<string, unknown>;
        toolCallId: string;
        toolName: string;
        turnId: string;
      };
      type: 'awaiting_approval';
    }
  | {
      message: Message;
      type: 'final_message';
    };

export type RunLoopResult =
  | {
      message: Message;
      status: 'completed';
    }
  | {
      status: 'awaiting_approval';
      toolCallId: string;
      turnId: string;
    };

const DEFAULT_MAX_TOOL_ITERATIONS = 12;

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function getFallbackAssistantContent(response: { text: string; toolCalls?: { length: number } }): string {
  if (response.text.trim()) {
    return response.text;
  }

  if (response.toolCalls?.length) {
    return '';
  }

  return 'I could not produce a response for that request.';
}

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        content: message.content,
        data: message.data,
        isError: message.isError,
        name: message.name,
        role: 'tool',
        toolCallId: message.toolCallId,
      };
    }

    if (message.role === 'assistant') {
      return {
        content: message.content,
        role: 'assistant',
        toolCalls: message.toolCalls,
      };
    }

    return {
      content: message.content,
      role: 'user',
    };
  });
}

async function appendMessage(session: Session, sessionStore: SessionStore, message: Message): Promise<void> {
  await sessionStore.appendMessage(session.id, message);
  session.messages.push(message);
}

async function updateSessionState(session: Session, sessionStore: SessionStore, patch: SessionStatePatch): Promise<void> {
  await sessionStore.updateSessionState(session.id, patch);
  applySessionStatePatch(session, patch);
}

function getProviderResponse({
  observer,
  provider,
  request,
  iteration,
  signal,
  stream,
}: {
  observer: ReturnType<typeof createLoopObserver>;
  provider: ModelProvider;
  request: ModelRequest;
  iteration: number;
  signal: AbortSignal | undefined;
  stream: boolean | undefined;
}): AsyncIterable<{ delta: string; type: 'text_delta' } | { response: ModelResponse; type: 'response_completed' }> {
  const providerStartTime = Date.now();

  if (!stream || !supportsStreaming(provider)) {
    return (async function* () {
      throwIfAborted(signal);
      const response = await provider.generate(request);

      observer.providerResponded(iteration, response, Date.now() - providerStartTime);

      yield {
        response,
        type: 'response_completed' as const,
      };
    })();
  }

  return (async function* () {
    let response: ModelResponse | null = null;
    let sawTextDelta = false;

    try {
      throwIfAborted(signal);

      for await (const event of provider.stream(request)) {
        throwIfAborted(signal);

        if (event.type === 'text_delta') {
          sawTextDelta ||= event.delta.length > 0;
          observer.providerTextDelta(iteration, event.delta);

          yield {
            delta: event.delta,
            type: 'text_delta',
          };

          continue;
        }

        if (response) {
          throw new Error('Provider stream returned more than one completed response.');
        }

        response = event.response;
      }
    } catch (error: unknown) {
      if (response) {
        // Preserve a completed streamed response if teardown fails afterward.
      } else if (sawTextDelta) {
        throw error;
      } else {
        throwIfAborted(signal);
        response = await provider.generate(request);
      }
    }

    if (!response) {
      throw new Error('Provider stream ended without a completed response.');
    }

    observer.providerResponded(iteration, response, Date.now() - providerStartTime);

    yield {
      response,
      type: 'response_completed',
    };
  })();
}

function getApprovalRequirement(toolCall: ModelToolCall, tools: Map<string, Tool>): ToolApprovalRequirement {
  const tool = tools.get(toolCall.name);

  if (!tool) {
    return { mode: 'auto' };
  }

  return tool.getApprovalRequirement?.(toolCall.input) ?? { mode: 'require' };
}

function findResumableToolBatch(
  messages: Message[],
  toolCallId: string,
): {
  nextToolCallIndex: number;
  toolCalls: ModelToolCall[];
} | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const toolCallIndex = message.toolCalls.findIndex((toolCall) => toolCall.id === toolCallId);

    if (toolCallIndex !== -1) {
      return {
        nextToolCallIndex: toolCallIndex + 1,
        toolCalls: message.toolCalls,
      };
    }
  }

  return null;
}

export async function* streamLoop({
  content,
  debug,
  emitEvent,
  logger,
  options,
  provider,
  resumeAfterToolCallId,
  signal,
  session,
  sessionStore,
  startContent,
  stream,
  systemPrompt,
  turnId,
  toolPolicy,
  tools,
}: RunLoopInput): AsyncIterable<TurnChunk> {
  const resolvedStartContent = startContent ?? content;
  const resolvedTurnId = turnId ?? randomUUID();
  const initialProgress = resolvedStartContent === undefined ? getCurrentTurnProgress(session.messages) : undefined;
  let currentIteration = initialProgress?.iteration ?? 0;
  let currentErrorType: 'provider' | 'tool' | 'runtime' = 'runtime';
  let totalToolCalls = initialProgress?.totalToolCalls ?? 0;
  const toolDefinitions = getToolDefinitions(tools);
  const toolsByName = getToolMap(tools);
  const toolContext = createToolContext(toolPolicy, { signal });
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = initialProgress?.toolIterations ?? 0;
  const observer = createLoopObserver({
    debug,
    emitEvent,
    logger,
    provider,
    sessionId: session.id,
    toolDefinitions,
    turnId: resolvedTurnId,
  });
  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;

  async function processToolCalls(
    toolCalls: ModelToolCall[],
    startIndex: number,
    iteration: number,
  ): Promise<Extract<TurnChunk, { type: 'awaiting_approval' }> | null> {
    for (let index = startIndex; index < toolCalls.length; index += 1) {
      const toolCall = toolCalls[index];

      throwIfAborted(signal);
      observer.toolRequested(iteration, toolCall);

      if (getApprovalRequirement(toolCall, toolsByName).mode === 'require') {
        await updateSessionState(session, sessionStore, {
          currentTurnId: resolvedTurnId,
          pendingApproval: { stage: 'awaiting_user', toolCallId: toolCall.id },
          turnStatus: 'awaiting_approval',
        });

        return {
          approval: {
            input: toolCall.input,
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            turnId: resolvedTurnId,
          },
          type: 'awaiting_approval',
        };
      }

      observer.toolStarted(iteration, toolCall);

      currentErrorType = 'tool';
      const toolStartTime = Date.now();
      const toolResult = await executeToolCall(toolCall, toolsByName, toolContext);
      currentErrorType = 'runtime';
      throwIfAborted(signal);
      observer.toolFinished(iteration, toolCall, toolResult, Date.now() - toolStartTime);

      await appendMessage(session, sessionStore, {
        ...toolResult,
        createdAt: new Date().toISOString(),
        role: 'tool',
      });
    }

    return null;
  }

  try {
    if (resolvedStartContent !== undefined) {
      observer.turnStarted(resolvedStartContent.length);
      throwIfAborted(signal);
      await appendMessage(session, sessionStore, {
        role: 'user',
        content: resolvedStartContent,
        createdAt: new Date().toISOString(),
      });
    }

    if (resumeAfterToolCallId !== undefined) {
      const resumableToolBatch = findResumableToolBatch(session.messages, resumeAfterToolCallId);

      if (!resumableToolBatch) {
        throw new Error(`Could not resume tool execution for tool call: ${resumeAfterToolCallId}`);
      }

      await updateSessionState(session, sessionStore, {
        currentTurnId: resolvedTurnId,
        pendingApproval: null,
        turnStatus: 'running',
      });

      const resumedResult = await processToolCalls(
        resumableToolBatch.toolCalls,
        resumableToolBatch.nextToolCallIndex,
        currentIteration,
      );

      if (resumedResult) {
        yield resumedResult;
        return;
      }
    }

    while (true) {
      currentIteration += 1;
      observer.iterationStarted(currentIteration, session.messages.length);
      observer.providerRequested(currentIteration, session.messages);

      currentErrorType = 'provider';
      throwIfAborted(signal);
      let response: ModelResponse | null = null;
      let streamedAssistantDelta = false;

      for await (const providerEvent of getProviderResponse({
        iteration: currentIteration,
        observer,
        provider,
        request: {
          messages: toModelMessages(session.messages),
          signal,
          systemPrompt: resolvedSystemPrompt,
          tools: toolDefinitions,
        },
        signal,
        stream,
      })) {
        throwIfAborted(signal);

        if (providerEvent.type === 'text_delta') {
          if (providerEvent.delta.length > 0) {
            streamedAssistantDelta = true;

            yield {
              delta: providerEvent.delta,
              type: 'assistant_delta',
            };
          }

          continue;
        }

        response = providerEvent.response;
      }

      if (!response) {
        throw new Error('Provider response stream ended without a completed response.');
      }

      currentErrorType = 'runtime';
      throwIfAborted(signal);

      if (response.toolCalls?.length) {
        toolIterations += 1;
        totalToolCalls += response.toolCalls.length;

        if (toolIterations > maxToolIterations) {
          throw new Error(`Tool loop exceeded ${maxToolIterations} iterations.`);
        }
      }

      const assistantMessage: Message = {
        content: getFallbackAssistantContent(response),
        createdAt: new Date().toISOString(),
        role: 'assistant',
        toolCalls: response.toolCalls,
      };

      await appendMessage(session, sessionStore, assistantMessage);

      if (!response.toolCalls?.length) {
        await updateSessionState(session, sessionStore, {
          currentTurnId: null,
          pendingApproval: null,
          turnStatus: 'idle',
        });
        observer.turnFinished(currentIteration, totalToolCalls, assistantMessage.content.length);

        yield {
          message: assistantMessage,
          type: 'final_message',
        };

        return;
      }

      if (streamedAssistantDelta) {
        yield {
          type: 'assistant_message_completed',
        };
      }

      const toolProcessingResult = await processToolCalls(response.toolCalls, 0, currentIteration);

      if (toolProcessingResult) {
        yield toolProcessingResult;
        return;
      }
    }
  } catch (error: unknown) {
    try {
      await updateSessionState(session, sessionStore, {
        currentTurnId: null,
        pendingApproval: null,
        turnStatus: 'idle',
      });
    } catch {
      // Preserve the original loop failure even if cleanup persistence also fails.
    }
    observer.turnFailed(currentIteration, currentErrorType, error);
    throw error;
  }
}

export async function runLoop(input: RunLoopInput): Promise<RunLoopResult> {
  for await (const chunk of streamLoop(input)) {
    if (chunk.type === 'assistant_delta' || chunk.type === 'assistant_message_completed') {
      continue;
    }

    if (chunk.type === 'awaiting_approval') {
      return {
        status: 'awaiting_approval',
        toolCallId: chunk.approval.toolCallId,
        turnId: chunk.approval.turnId,
      };
    }

    return {
      message: chunk.message,
      status: 'completed',
    };
  }

  throw new Error('Loop ended without a final assistant message or approval request.');
}
