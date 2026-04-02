import { HarnessObserver } from '../events/observer.js';
import type { ModelProvider } from '../models/provider.js';
import { supportsStreaming } from '../models/provider.js';
import type { ModelMessage, ModelRequest, ModelResponse } from '../models/types.js';
import type { Message } from '../sessions/types.js';
import { createToolContext } from '../tools/context.js';
import type { ToolPolicy } from '../tools/context.js';
import { executeToolCall, getToolDefinitions, getToolMap } from '../tools/runtime.js';
import type { Tool } from '../tools/types.js';

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
      message: Message;
      type: 'final_message';
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
  toolPolicy,
  tools,
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
  const toolsByName = getToolMap(tools);
  const toolDefinitions = getToolDefinitions(tools);
  const toolContext = createToolContext(toolPolicy, { signal });
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = 0;
  observer.turnStarted(content.length);
  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;
  const getTranscript = (): Message[] => [...history, ...turnMessages];

  try {
    throwIfAborted(signal);
    appendMessage(turnMessages, userMessage);

    while (true) {
      const transcript = getTranscript();

      currentIteration += 1;
      observer.iterationStarted(currentIteration, transcript.length);
      observer.providerRequested(currentIteration, transcript, provider, toolDefinitions);

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

      appendMessage(turnMessages, assistantMessage);

      if (!response.toolCalls?.length) {
        observer.turnFinished(currentIteration, totalToolCalls, assistantMessage.content.length);

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

      for (const toolCall of response.toolCalls) {
        throwIfAborted(signal);
        observer.toolRequested(currentIteration, toolCall);
        observer.toolStarted(currentIteration, toolCall);

        currentErrorType = 'tool';
        const toolStartTime = Date.now();
        const toolResult = await executeToolCall(toolCall, toolsByName, toolContext);
        currentErrorType = 'runtime';
        throwIfAborted(signal);
        observer.toolFinished(currentIteration, toolCall, toolResult, Date.now() - toolStartTime);

        appendMessage(turnMessages, {
          ...toolResult,
          createdAt: new Date().toISOString(),
          role: 'tool',
        });
      }
    }
  } catch (error: unknown) {
    observer.turnFailed(currentIteration, currentErrorType, error);
    throw error;
  }
}
