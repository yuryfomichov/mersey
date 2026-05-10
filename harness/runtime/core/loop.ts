import { injectTurnContextMessages } from '../context/pipeline.js';
import type { TurnContextCollectorRunner } from '../context/runner.js';
import { getMessageCountsByRole, HarnessEventReporter } from '../events/reporter.js';
import type { ModelProvider } from '../models/provider.js';
import type { AssistantToolCall, ModelMessage, ModelRequest, ModelResponse } from '../models/types.js';
import type { PluginRunner } from '../plugins/runner.js';
import type { Message } from '../sessions/types.js';
import { getRuntimeSourceErrorSourceIds } from '../sources.js';
import type { ResolvedToolCall } from '../tools/catalog.js';
import type { ComposedToolCatalog } from '../tools/composed-catalog.js';
import { projectToolResultToText, sanitizeToolExecutionResult } from '../tools/result.js';
import { CancellationService } from '../tools/runtime/cancellation/cancellation-service.js';
import { createTextToolResult } from '../tools/types.js';

export type LoopOptions = {
  maxToolIterations?: number;
};

export type LoopInput = {
  content: string;
  contextCollectors: TurnContextCollectorRunner;
  history: readonly Message[];
  options?: LoopOptions;
  pluginRunner: PluginRunner;
  provider: ModelProvider;
  reporter: HarnessEventReporter;
  signal?: AbortSignal;
  stream: boolean;
  systemPrompt?: string;
  toolCatalog: ComposedToolCatalog;
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
      message: Message;
      type: 'final_message';
    };

const DEFAULT_MAX_TOOL_ITERATIONS = 12;

function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    if (message.role === 'user') {
      return {
        content: message.content,
        role: 'user',
      };
    }

    if (message.role === 'assistant') {
      return {
        content: message.content,
        role: 'assistant',
        ...(message.toolCalls ? { toolCalls: structuredClone(message.toolCalls) } : {}),
      };
    }

    return {
      content: message.content,
      ...(message.isError === undefined ? {} : { isError: message.isError }),
      ...(message.metadata === undefined ? {} : { metadata: structuredClone(message.metadata) }),
      parts: structuredClone(message.parts),
      publicName: message.publicName,
      role: 'tool',
      toolCallId: message.toolCallId,
      toolId: message.toolId,
    };
  });
}

function appendMessage(messages: Message[], message: Message): void {
  messages.push(message);
}

function resolveToolCall(
  toolCall: NonNullable<ModelResponse['toolCalls']>[number],
  toolSnapshot: Awaited<ReturnType<ComposedToolCatalog['snapshot']>>['snapshot'],
): ResolvedToolCall {
  return (
    toolSnapshot.resolve(toolCall) ?? {
      input: structuredClone(toolCall.input),
      originalName: toolCall.name,
      publicName: toolCall.name,
      rawCall: structuredClone(toolCall),
      sourceId: 'unknown',
      toolCallId: toolCall.id,
      toolId: `unknown:${toolCall.name}`,
    }
  );
}

function toAssistantToolCall(tool: ResolvedToolCall): AssistantToolCall {
  return {
    id: tool.toolCallId,
    input: structuredClone(tool.input),
    name: tool.publicName,
    originalName: tool.originalName,
    publicName: tool.publicName,
    sourceId: tool.sourceId,
    toolId: tool.toolId,
  };
}

async function* getProviderResponse({
  reporter,
  provider,
  request,
  iteration,
  signal,
}: {
  iteration: number;
  provider: ModelProvider;
  reporter: HarnessEventReporter;
  request: ModelRequest;
  signal: AbortSignal | undefined;
}): AsyncIterable<{ delta: string; type: 'text_delta' } | { response: ModelResponse; type: 'response_completed' }> {
  const providerStartTime = Date.now();
  let response: ModelResponse | null = null;
  const protocolViolationError = 'Provider stream returned more than one completed response.';

  try {
    throwIfAborted(signal);

    for await (const event of provider.generate(request)) {
      throwIfAborted(signal);

      if (event.type === 'text_delta') {
        yield {
          delta: event.delta,
          type: 'text_delta',
        };

        continue;
      }

      if (response) {
        throw new Error(protocolViolationError);
      }

      response = event.response;
    }
  } catch (error: unknown) {
    if (error instanceof Error && error.message === protocolViolationError) {
      throw error;
    }

    if (!response) {
      throw error;
    }
  }

  if (!response) {
    throw new Error('Provider stream ended without a completed response.');
  }

  reporter.providerResponded(iteration, provider, response, Date.now() - providerStartTime);

  yield {
    response,
    type: 'response_completed',
  };
}

export async function* streamLoop({
  content,
  contextCollectors,
  history,
  reporter,
  options,
  pluginRunner,
  provider,
  signal,
  stream,
  systemPrompt,
  toolCatalog,
}: LoopInput): AsyncGenerator<TurnChunk, Message[]> {
  let currentIteration = 0;
  let currentErrorType: 'provider' | 'tool' | 'runtime' = 'runtime';
  let totalToolCalls = 0;
  const turnMessages: Message[] = [];

  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = 0;
  reporter.turnStarted(content.length);
  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;
  const getTranscript = (): Message[] => [...history, ...turnMessages];
  const cancellation = new CancellationService({ signal });

  try {
    throwIfAborted(signal);
    appendMessage(turnMessages, userMessage);

    reporter.turnSnapshotStarted(1);
    let toolSnapshotResult: Awaited<ReturnType<ComposedToolCatalog['snapshot']>>;
    let contextSnapshot: Awaited<ReturnType<TurnContextCollectorRunner['collect']>>;

    try {
      toolSnapshotResult = await toolCatalog.snapshot({
        iteration: 1,
        reporter,
        sessionId: reporter.getSessionId(),
        turnId: reporter.getTurnId(),
      });
      contextSnapshot = await contextCollectors.collect(
        {
          iteration: 1,
          model: provider.model,
          providerName: provider.name,
          sessionId: reporter.getSessionId(),
          signal,
          transcript: getTranscript(),
          turnId: reporter.getTurnId(),
          userMessage: {
            content: userMessage.content,
            role: 'user',
          },
        },
        reporter,
      );
    } catch (error: unknown) {
      reporter.turnSnapshotFailed(1, getRuntimeSourceErrorSourceIds(error), getErrorMessage(error));
      throw error;
    }

    reporter.turnSnapshotCompleted(1, {
      context: contextSnapshot.context,
      toolDefinitionCount: toolSnapshotResult.snapshot.descriptors.length,
    });

    const toolDefinitions = toolSnapshotResult.snapshot.descriptors.map((descriptor) => descriptor.definition);
    const injectedContextMessages = injectTurnContextMessages(contextSnapshot.context);

    while (true) {
      const transcript = getTranscript();
      const modelMessages = [
        ...injectedContextMessages.map((message) => structuredClone(message)),
        ...toModelMessages(transcript),
      ];

      currentIteration += 1;
      reporter.iterationStarted(currentIteration, transcript.length);

      const request: ModelRequest = {
        context: contextSnapshot.context,
        messages: modelMessages,
        signal,
        stream,
        systemPrompt: resolvedSystemPrompt,
        tools: toolDefinitions.length > 0 ? toolDefinitions : undefined,
      };

      currentErrorType = 'provider';

      const providerCtx = {
        iteration: currentIteration,
        messageCount: request.messages.length,
        messageCountsByRole: getMessageCountsByRole(request.messages),
        model: provider.model,
        providerName: provider.name,
        request: Object.freeze({
          ...(request.context ? { context: request.context } : {}),
          messages: Object.freeze(request.messages.map((message) => Object.freeze(structuredClone(message)))),
          stream: request.stream,
          ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
          ...(request.tools
            ? { tools: Object.freeze(request.tools.map((tool) => Object.freeze(structuredClone(tool)))) }
            : {}),
        }),
        sessionId: reporter.getSessionId(),
        toolDefinitionNames: request.tools?.map((tool) => tool.name) ?? [],
        turnId: reporter.getTurnId(),
      };

      const providerDecision = await pluginRunner.runBeforeProviderCall(providerCtx);

      if (providerDecision.continue === false) {
        currentErrorType = 'provider';
        const exposeToModel = providerDecision.exposeToModel ?? false;
        reporter.providerBlocked(currentIteration, providerDecision.reason, exposeToModel);
        throw new Error(exposeToModel ? providerDecision.reason : 'Provider request blocked by policy.');
      }

      reporter.providerRequested(currentIteration, request, provider);

      throwIfAborted(signal);
      let response: ModelResponse | null = null;
      let streamedAssistantDelta = false;

      for await (const providerEvent of getProviderResponse({
        iteration: currentIteration,
        reporter,
        provider,
        request,
        signal,
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

      const resolvedToolCalls =
        response.toolCalls?.map((toolCall) => resolveToolCall(toolCall, toolSnapshotResult.snapshot)) ?? [];

      if (resolvedToolCalls.length > 0) {
        toolIterations += 1;
        totalToolCalls += resolvedToolCalls.length;

        if (toolIterations > maxToolIterations) {
          throw new Error(`Tool loop exceeded ${maxToolIterations} iterations.`);
        }
      }

      const assistantMessage: Message = {
        content: getFallbackAssistantContent(response),
        createdAt: new Date().toISOString(),
        role: 'assistant',
        toolCalls: resolvedToolCalls.map((tool) => toAssistantToolCall(tool)),
        usage: response.usage,
      };

      appendMessage(turnMessages, assistantMessage);

      if (resolvedToolCalls.length === 0) {
        reporter.turnFinished(currentIteration, totalToolCalls, assistantMessage.content.length);

        yield {
          message: assistantMessage,
          type: 'final_message',
        };

        return turnMessages;
      }

      if (streamedAssistantDelta) {
        yield {
          type: 'assistant_message_completed',
        };
      }

      for (const tool of resolvedToolCalls) {
        throwIfAborted(signal);
        reporter.toolRequested(currentIteration, tool);

        const toolDecision = await pluginRunner.runBeforeToolExecution({
          iteration: currentIteration,
          sessionId: reporter.getSessionId(),
          tool,
          turnId: reporter.getTurnId(),
        });

        if (toolDecision.continue === false) {
          const exposeToModel = toolDecision.exposeToModel ?? false;
          reporter.toolBlocked(currentIteration, tool, toolDecision.reason, exposeToModel);

          const blockedResult = createTextToolResult(
            exposeToModel ? toolDecision.reason : 'Tool call denied by policy.',
            {
              isError: true,
            },
          );

          appendMessage(turnMessages, {
            content: projectToolResultToText(blockedResult),
            createdAt: new Date().toISOString(),
            isError: true,
            metadata: blockedResult.metadata,
            parts: blockedResult.parts,
            publicName: tool.publicName,
            role: 'tool',
            toolCallId: tool.toolCallId,
            toolId: tool.toolId,
          });

          continue;
        }

        reporter.toolStarted(currentIteration, tool);

        currentErrorType = 'tool';
        const toolStartTime = Date.now();
        const toolResult = sanitizeToolExecutionResult(
          tool.sourceId === 'unknown'
            ? createTextToolResult(`Unknown tool: ${tool.publicName}`, { isError: true })
            : await toolSnapshotResult.snapshot.execute(tool, { cancellation }),
        );
        currentErrorType = 'runtime';
        throwIfAborted(signal);
        reporter.toolFinished(currentIteration, tool, toolResult, Date.now() - toolStartTime);

        appendMessage(turnMessages, {
          content: projectToolResultToText(toolResult),
          createdAt: new Date().toISOString(),
          isError: toolResult.isError,
          metadata: toolResult.metadata,
          parts: toolResult.parts,
          publicName: tool.publicName,
          role: 'tool',
          toolCallId: tool.toolCallId,
          toolId: tool.toolId,
        });
      }
    }
  } catch (error: unknown) {
    reporter.turnFailed(currentIteration, currentErrorType, error);
    throw error;
  }
}
