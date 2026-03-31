import type { HarnessEvent } from './events/index.js';
import type { HarnessLogger } from './logger/index.js';
import { createLoopObserver } from './loop-observer.js';
import type { ModelProvider } from './models/index.js';
import type { ModelMessage } from './models/index.js';
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
  toolPolicy: ToolPolicy;
  tools: Tool[];
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

export async function runLoop({
  content,
  debug,
  emitEvent,
  logger,
  options,
  provider,
  session,
  sessionStore,
  toolPolicy,
  tools,
}: RunLoopInput): Promise<Message> {
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

  try {
    await appendMessage(session, sessionStore, userMessage);

    while (true) {
      currentIteration += 1;
      observer.iterationStarted(currentIteration, session.messages.length);
      observer.providerRequested(currentIteration, session.messages);

      currentErrorType = 'provider';
      const providerStartTime = Date.now();
      const response = await provider.generate({
        messages: toModelMessages(session.messages),
        tools: toolDefinitions,
      });
      currentErrorType = 'runtime';
      observer.providerResponded(currentIteration, response, Date.now() - providerStartTime);

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

        return assistantMessage;
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
