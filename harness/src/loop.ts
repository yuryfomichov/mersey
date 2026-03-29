import type { ModelProvider } from './models/index.js';
import type { ModelMessage } from './models/index.js';
import type { SessionStore } from './sessions/index.js';
import type { Message, Session } from './sessions/index.js';
import { executeToolCall, getToolDefinitions, getToolMap } from './tools/index.js';
import type { Tool } from './tools/index.js';

export type RunLoopOptions = {
  maxToolIterations?: number;
};

export type RunLoopInput = {
  content: string;
  options?: RunLoopOptions;
  provider: ModelProvider;
  session: Session;
  sessionStore: SessionStore;
  tools: Tool[];
};

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

function toModelMessages(messages: Message[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        content: message.content,
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
  options,
  provider,
  session,
  sessionStore,
  tools,
}: RunLoopInput): Promise<Message> {
  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };

  await appendMessage(session, sessionStore, userMessage);

  const toolDefinitions = getToolDefinitions(tools);
  const toolsByName = getToolMap(tools);
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = 0;

  while (true) {
    const response = await provider.generate({
      messages: toModelMessages(session.messages),
      tools: toolDefinitions,
    });

    const assistantMessage: Message = {
      content: response.text,
      createdAt: new Date().toISOString(),
      role: 'assistant',
      toolCalls: response.toolCalls,
    };

    await appendMessage(session, sessionStore, assistantMessage);

    if (!response.toolCalls?.length) {
      return assistantMessage;
    }

    toolIterations += 1;

    if (toolIterations > maxToolIterations) {
      throw new Error(`Tool loop exceeded ${maxToolIterations} iterations.`);
    }

    for (const toolCall of response.toolCalls) {
      const toolResult = await executeToolCall(toolCall, toolsByName);

      await appendMessage(session, sessionStore, {
        ...toolResult,
        createdAt: new Date().toISOString(),
        role: 'tool',
      });
    }
  }
}
