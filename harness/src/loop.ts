import type { HarnessEvent } from './events/index.js';
import type { HarnessLogger } from './logger/index.js';
import { createLoopObserver } from './loop-observer.js';
import type { ModelProvider } from './models/index.js';
import type { ModelMessage } from './models/index.js';
import { supportsStreaming } from './models/index.js';
import type { ModelRequest, ModelResponse } from './models/index.js';
import type { SessionStore } from './sessions/index.js';
import type { Message, Session } from './sessions/index.js';
import { createToolContext, executeToolCall, getToolDefinitions, getToolMap } from './tools/index.js';
import type { Tool, ToolPolicy } from './tools/index.js';

export type RunLoopOptions = {
  maxToolIterations?: number;
};

export type RunLoopInput = {
  content: string;
  debug?: boolean;
  emitEvent?: (event: HarnessEvent) => void;
  logger?: HarnessLogger;
  options?: RunLoopOptions;
  provider: ModelProvider;
  session: Session;
  sessionStore: SessionStore;
  stream?: boolean;
  systemPrompt?: string;
  toolPolicy: ToolPolicy;
  tools: Tool[];
};

export type RunLoopResult = {
  finalReplyStreamed: boolean;
  message: Message;
};

const DEFAULT_MAX_TOOL_ITERATIONS = 12;

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

async function getProviderResponse({
  observer,
  provider,
  request,
  iteration,
  stream,
}: {
  observer: ReturnType<typeof createLoopObserver>;
  provider: ModelProvider;
  request: ModelRequest;
  iteration: number;
  stream: boolean | undefined;
}): Promise<{ response: ModelResponse; streamedTextLength: number }> {
  const providerStartTime = Date.now();

  if (!stream || !supportsStreaming(provider)) {
    const response = await provider.generate(request);

    observer.providerResponded(iteration, response, Date.now() - providerStartTime);

    return {
      response,
      streamedTextLength: 0,
    };
  }

  let response: ModelResponse | null = null;
  let sawTextDelta = false;
  let streamedTextLength = 0;

  try {
    for await (const event of provider.stream(request)) {
      if (event.type === 'text_delta') {
        sawTextDelta ||= event.delta.length > 0;
        streamedTextLength += event.delta.length;
        observer.providerTextDelta(iteration, event.delta);
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
      response = await provider.generate(request);
    }
  }

  if (!response) {
    throw new Error('Provider stream ended without a completed response.');
  }

  observer.providerResponded(iteration, response, Date.now() - providerStartTime);

  return {
    response,
    streamedTextLength,
  };
}

export async function runLoop({
  content,
  debug,
  emitEvent,
  logger,
  options,
  provider,
  session,
  sessionStore,
  stream,
  systemPrompt,
  toolPolicy,
  tools,
}: RunLoopInput): Promise<RunLoopResult> {
  let currentIteration = 0;
  let currentErrorType: 'provider' | 'tool' | 'runtime' = 'runtime';
  let totalToolCalls = 0;

  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
  const toolDefinitions = getToolDefinitions(tools);
  const toolsByName = getToolMap(tools);
  const toolContext = createToolContext(toolPolicy);
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = 0;
  const observer = createLoopObserver({
    debug,
    emitEvent,
    logger,
    provider,
    sessionId: session.id,
    toolDefinitions,
  });
  observer.turnStarted(content.length);
  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;

  try {
    await appendMessage(session, sessionStore, userMessage);

    while (true) {
      currentIteration += 1;
      observer.iterationStarted(currentIteration, session.messages.length);
      observer.providerRequested(currentIteration, session.messages);

      currentErrorType = 'provider';
      const { response, streamedTextLength } = await getProviderResponse({
        iteration: currentIteration,
        observer,
        provider,
        request: {
          messages: toModelMessages(session.messages),
          systemPrompt: resolvedSystemPrompt,
          tools: toolDefinitions,
        },
        stream,
      });
      currentErrorType = 'runtime';

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
        observer.turnFinished(currentIteration, totalToolCalls, assistantMessage.content.length);

        return {
          finalReplyStreamed: streamedTextLength > 0,
          message: assistantMessage,
        };
      }

      for (const toolCall of response.toolCalls) {
        observer.toolRequested(currentIteration, toolCall);
        observer.toolStarted(currentIteration, toolCall);

        currentErrorType = 'tool';
        const toolStartTime = Date.now();
        const toolResult = await executeToolCall(toolCall, toolsByName, toolContext);
        currentErrorType = 'runtime';
        observer.toolFinished(currentIteration, toolCall, toolResult, Date.now() - toolStartTime);

        await appendMessage(session, sessionStore, {
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
