import type { ApprovalDecision, PendingApproval } from '../approvals/types.js';
import { requiresApproval } from '../approvals/types.js';
import { HarnessObserver } from '../events/observer.js';
import type { ModelProvider } from '../models/provider.js';
import { supportsStreaming } from '../models/provider.js';
import type { ModelMessage, ModelRequest, ModelResponse } from '../models/types.js';
import type { AssistantMessage, Message } from '../sessions/types.js';
import type { ToolRuntimeFactory } from '../tools/runtime/index.js';
import type { ToolExecutionResult } from '../tools/types.js';

export type LoopOptions = {
  maxToolIterations?: number;
};

export type LoopInput = {
  content: string;
  history: readonly Message[];
  observer: HarnessObserver;
  options?: LoopOptions;
  provider: ModelProvider;
  signal?: AbortSignal;
  stream?: boolean;
  systemPrompt?: string;
  toolRuntimeFactory: ToolRuntimeFactory;
};

export type ApprovalInput = {
  approvalDecisions: ApprovalDecision[];
  history: readonly Message[];
  observer: HarnessObserver;
  options?: LoopOptions;
  pendingApproval: PendingApproval;
  provider: ModelProvider;
  signal?: AbortSignal;
  stream?: boolean;
  systemPrompt?: string;
  toolRuntimeFactory: ToolRuntimeFactory;
};

export type TurnChunk =
  | {
      delta: string;
      type: 'assistant_delta';
    }
  | {
      pendingApproval: PendingApproval;
      type: 'approval_requested';
    }
  | {
      type: 'assistant_message_completed';
    }
  | {
      message: Message;
      type: 'final_message';
    };

const DEFAULT_MAX_TOOL_ITERATIONS = 12;

export type LoopResult =
  | {
      pendingApproval: PendingApproval;
      status: 'awaiting_approval';
      turnMessages: Message[];
    }
  | {
      status: 'completed';
      turnMessages: Message[];
    };

type ContinueLoopInput = {
  history: readonly Message[];
  initialIteration: number;
  initialToolBatch?: {
    approvalDecisions?: ApprovalDecision[];
    pendingApproval?: PendingApproval;
    toolCalls: NonNullable<ModelResponse['toolCalls']>;
  };
  observer: HarnessObserver;
  options?: LoopOptions;
  provider: ModelProvider;
  signal?: AbortSignal;
  stream?: boolean;
  systemPrompt?: string;
  toolIterations: number;
  toolRuntimeFactory: ToolRuntimeFactory;
  totalToolCalls: number;
  turnMessages: Message[];
};

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

function toModelMessages(messages: readonly Message[]): ModelMessage[] {
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

function appendMessage(messages: Message[], message: Message): void {
  messages.push(message);
}

function createPendingApproval(
  assistantMessage: AssistantMessage,
  observer: HarnessObserver,
  requiredToolCallIds: string[],
  toolIterations: number,
  totalToolCalls: number,
): PendingApproval {
  return {
    assistantMessage: structuredClone(assistantMessage),
    requiredToolCallIds,
    toolIterations,
    totalToolCalls,
    turnId: observer.activeTurnId(),
  };
}

function getRequiredToolCallIds(
  toolCalls: NonNullable<ModelResponse['toolCalls']>,
  toolRuntime: ReturnType<ToolRuntimeFactory>,
): string[] {
  return toolCalls
    .filter((toolCall) => toolRuntime.getToolCallAction(toolCall) === 'require_approval')
    .map((toolCall) => toolCall.id);
}

function createDeniedToolResult(toolCall: NonNullable<ModelResponse['toolCalls']>[number]): ToolExecutionResult {
  return {
    content: `Tool execution denied by user: ${toolCall.name}`,
    isError: true,
    name: toolCall.name,
    toolCallId: toolCall.id,
  };
}

async function executeToolCalls({
  approvalDecisions,
  currentIteration,
  observer,
  pendingApproval,
  signal,
  toolCalls,
  toolRuntime,
  turnMessages,
}: {
  approvalDecisions?: ApprovalDecision[];
  currentIteration: number;
  observer: HarnessObserver;
  pendingApproval?: PendingApproval;
  signal: AbortSignal | undefined;
  toolCalls: NonNullable<ModelResponse['toolCalls']>;
  toolRuntime: ReturnType<ToolRuntimeFactory>;
  turnMessages: Message[];
}): Promise<void> {
  const decisionsById = new Map(approvalDecisions?.map((decision) => [decision.toolCallId, decision.type]));

  for (const toolCall of toolCalls) {
    throwIfAborted(signal);
    observer.toolRequested(currentIteration, toolCall);
    observer.toolStarted(currentIteration, toolCall);

    const toolStartTime = Date.now();
    const toolResult =
      pendingApproval && requiresApproval(toolCall, pendingApproval) && decisionsById.get(toolCall.id) === 'deny'
        ? createDeniedToolResult(toolCall)
        : await toolRuntime.executeToolCall(toolCall);

    throwIfAborted(signal);
    observer.toolFinished(currentIteration, toolCall, toolResult, Date.now() - toolStartTime);

    appendMessage(turnMessages, {
      ...toolResult,
      createdAt: new Date().toISOString(),
      role: 'tool',
    });
  }
}

function validateApprovalDecisions(pendingApproval: PendingApproval, approvalDecisions: ApprovalDecision[]): void {
  const decisionsById = new Map(approvalDecisions.map((decision) => [decision.toolCallId, decision.type]));

  for (const toolCallId of pendingApproval.requiredToolCallIds) {
    if (!decisionsById.has(toolCallId)) {
      throw new Error(`Missing approval decision for tool call: ${toolCallId}`);
    }
  }
}

function historyIncludesPendingApprovalMessage(history: readonly Message[], pendingApproval: PendingApproval): boolean {
  const lastMessage = history.at(-1);
  const pendingToolCallIds = pendingApproval.assistantMessage.toolCalls?.map((toolCall) => toolCall.id) ?? [];
  const lastToolCallIds =
    lastMessage?.role === 'assistant' ? (lastMessage.toolCalls?.map((toolCall) => toolCall.id) ?? []) : [];

  return (
    lastMessage?.role === 'assistant' &&
    lastMessage.createdAt === pendingApproval.assistantMessage.createdAt &&
    lastMessage.content === pendingApproval.assistantMessage.content &&
    lastToolCallIds.length === pendingToolCallIds.length &&
    lastToolCallIds.every((toolCallId, index) => toolCallId === pendingToolCallIds[index])
  );
}

async function* continueLoop({
  history,
  initialIteration,
  initialToolBatch,
  observer,
  options,
  provider,
  signal,
  stream,
  systemPrompt,
  toolIterations: initialToolIterations,
  toolRuntimeFactory,
  totalToolCalls: initialTotalToolCalls,
  turnMessages,
}: ContinueLoopInput): AsyncGenerator<TurnChunk, LoopResult> {
  let currentIteration = initialIteration;
  let currentErrorType: 'provider' | 'tool' | 'runtime' = 'runtime';
  let totalToolCalls = initialTotalToolCalls;
  const toolRuntime = toolRuntimeFactory({ signal });
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = initialToolIterations;
  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;
  const getTranscript = (): Message[] => [...history, ...turnMessages];

  try {
    if (initialToolBatch) {
      currentErrorType = 'tool';
      await executeToolCalls({
        approvalDecisions: initialToolBatch.approvalDecisions,
        currentIteration,
        observer,
        pendingApproval: initialToolBatch.pendingApproval,
        signal,
        toolCalls: initialToolBatch.toolCalls,
        toolRuntime,
        turnMessages,
      });
      currentErrorType = 'runtime';
    }

    while (true) {
      const transcript = getTranscript();

      currentIteration += 1;
      observer.iterationStarted(currentIteration, transcript.length);
      observer.providerRequested(currentIteration, transcript, provider, toolRuntime.toolDefinitions);

      currentErrorType = 'provider';
      throwIfAborted(signal);
      let response: ModelResponse | null = null;
      let streamedAssistantDelta = false;

      for await (const providerEvent of getProviderResponse({
        iteration: currentIteration,
        observer,
        provider,
        request: {
          messages: toModelMessages(transcript),
          signal,
          systemPrompt: resolvedSystemPrompt,
          tools: toolRuntime.toolDefinitions,
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

      const assistantMessage: AssistantMessage = {
        content: getFallbackAssistantContent(response),
        createdAt: new Date().toISOString(),
        role: 'assistant',
        toolCalls: response.toolCalls,
      };

      appendMessage(turnMessages, assistantMessage);

      if (!response.toolCalls?.length) {
        observer.turnFinished(currentIteration, totalToolCalls, assistantMessage.content.length);

        yield {
          message: assistantMessage,
          type: 'final_message',
        };

        return { status: 'completed', turnMessages };
      }

      if (streamedAssistantDelta) {
        yield {
          type: 'assistant_message_completed',
        };
      }

      const requiredToolCallIds = getRequiredToolCallIds(response.toolCalls, toolRuntime);

      if (requiredToolCallIds.length > 0) {
        const pendingApproval = createPendingApproval(
          assistantMessage,
          observer,
          requiredToolCallIds,
          toolIterations,
          totalToolCalls,
        );

        observer.approvalRequested(response.toolCalls, requiredToolCallIds);
        observer.turnPaused();

        yield {
          pendingApproval,
          type: 'approval_requested',
        };

        return {
          pendingApproval,
          status: 'awaiting_approval',
          turnMessages,
        };
      }

      currentErrorType = 'tool';
      await executeToolCalls({
        currentIteration,
        observer,
        signal,
        toolCalls: response.toolCalls,
        toolRuntime,
        turnMessages,
      });
      currentErrorType = 'runtime';
    }
  } catch (error: unknown) {
    observer.turnFailed(currentIteration, currentErrorType, error);
    throw error;
  }
}

function getProviderResponse({
  observer,
  provider,
  request,
  iteration,
  signal,
  stream,
}: {
  observer: HarnessObserver;
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

      observer.providerResponded(iteration, provider, response, Date.now() - providerStartTime);

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

    observer.providerResponded(iteration, provider, response, Date.now() - providerStartTime);

    yield {
      response,
      type: 'response_completed',
    };
  })();
}

export async function* streamLoop({
  content,
  history,
  observer,
  options,
  provider,
  signal,
  stream,
  systemPrompt,
  toolRuntimeFactory,
}: LoopInput): AsyncGenerator<TurnChunk, LoopResult> {
  const turnMessages: Message[] = [];

  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
  observer.turnStarted(content.length);
  throwIfAborted(signal);
  appendMessage(turnMessages, userMessage);

  return yield* continueLoop({
    history,
    initialIteration: 0,
    observer,
    options,
    provider,
    signal,
    stream,
    systemPrompt,
    toolIterations: 0,
    toolRuntimeFactory,
    totalToolCalls: 0,
    turnMessages,
  });
}

export async function* streamApprovalLoop({
  approvalDecisions,
  history,
  observer,
  options,
  pendingApproval,
  provider,
  signal,
  stream,
  systemPrompt,
  toolRuntimeFactory,
}: ApprovalInput): AsyncGenerator<TurnChunk, LoopResult> {
  const assistantToolCalls = pendingApproval.assistantMessage.toolCalls;

  if (!assistantToolCalls?.length) {
    throw new Error('Pending approval has no tool calls to resume.');
  }

  validateApprovalDecisions(pendingApproval, approvalDecisions);

  const hasPendingApprovalMessage = historyIncludesPendingApprovalMessage(history, pendingApproval);
  const resumeHistory = hasPendingApprovalMessage ? [...history] : [...history, pendingApproval.assistantMessage];
  const turnMessages: Message[] = hasPendingApprovalMessage ? [] : [pendingApproval.assistantMessage];

  observer.turnResumed(pendingApproval.turnId);
  observer.approvalResolved(approvalDecisions);

  return yield* continueLoop({
    history: resumeHistory,
    initialIteration: 1,
    initialToolBatch: {
      approvalDecisions,
      pendingApproval,
      toolCalls: assistantToolCalls,
    },
    observer,
    options,
    provider,
    signal,
    stream,
    systemPrompt,
    toolIterations: pendingApproval.toolIterations,
    toolRuntimeFactory,
    totalToolCalls: pendingApproval.totalToolCalls,
    turnMessages,
  });
}
