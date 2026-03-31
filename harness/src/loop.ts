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
  options?: RunLoopOptions;
  provider: ModelProvider;
  session: Session;
  sessionStore: SessionStore;
  systemPrompt?: string;
  toolPolicy: ToolPolicy;
  tools: Tool[];
};

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

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
  options,
  provider,
  session,
  sessionStore,
  systemPrompt,
  toolPolicy,
  tools,
}: RunLoopInput): Promise<Message> {
  const userMessage: Message = {
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };

  await appendMessage(session, sessionStore, userMessage);

  const resolvedSystemPrompt = systemPrompt?.trim() ? systemPrompt : undefined;
  const toolDefinitions = getToolDefinitions(tools);
  const toolsByName = getToolMap(tools);
  const toolContext = createToolContext(toolPolicy);
  const maxToolIterations = options?.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  let toolIterations = 0;

  while (true) {
    const response = await provider.generate({
      messages: toModelMessages(session.messages),
      systemPrompt: resolvedSystemPrompt,
      tools: toolDefinitions,
    });

    if (response.toolCalls?.length) {
      toolIterations += 1;

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
      return assistantMessage;
    }

    for (const toolCall of response.toolCalls) {
      const toolResult = await executeToolCall(toolCall, toolsByName, toolContext);

      await appendMessage(session, sessionStore, {
        ...toolResult,
        createdAt: new Date().toISOString(),
        role: 'tool',
      });
    }
  }
}
