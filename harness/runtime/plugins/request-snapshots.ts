import type { ModelMessage, ModelRequest } from '../models/types.js';
import type { Message } from '../sessions/types.js';
import { freezeDeep } from '../utils/object.js';
import type { PrepareProviderRequestMessage, ProviderRequestSnapshot } from './types.js';

function cloneToolDataForPlugin(data: Record<string, unknown>): Record<string, unknown> | undefined {
  try {
    return structuredClone(data);
  } catch {
    return undefined;
  }
}

function toPrepareProviderRequestMessage(message: ModelMessage | Message): PrepareProviderRequestMessage {
  if (message.role === 'tool') {
    return {
      content: message.content,
      ...(message.data ? { data: cloneToolDataForPlugin(message.data) } : {}),
      isError: message.isError,
      name: message.name,
      role: 'tool',
      toolCallId: message.toolCallId,
    };
  }

  return {
    content: message.content,
    role: message.role,
    ...(message.role === 'assistant' && message.toolCalls ? { toolCalls: structuredClone(message.toolCalls) } : {}),
  };
}

export function toModelMessage(message: PrepareProviderRequestMessage): ModelMessage {
  if (message.role === 'tool') {
    return {
      content: message.content,
      ...(message.data ? { data: cloneToolDataForPlugin(message.data) } : {}),
      isError: message.isError,
      name: message.name,
      role: 'tool',
      toolCallId: message.toolCallId,
    };
  }

  return {
    content: message.content,
    role: message.role,
    ...(message.role === 'assistant' && message.toolCalls ? { toolCalls: structuredClone(message.toolCalls) } : {}),
  };
}

export function toModelMessages(messages: readonly PrepareProviderRequestMessage[]): ModelMessage[] {
  return messages.map((message) => toModelMessage(message));
}

export function toPrepareProviderRequestMessages(messages: readonly ModelMessage[]): PrepareProviderRequestMessage[] {
  return messages.map((message) => toPrepareProviderRequestMessage(message));
}

export function toPrepareProviderRequestTranscript(messages: readonly Message[]): PrepareProviderRequestMessage[] {
  return messages.map((message) => toPrepareProviderRequestMessage(message));
}

export function toProviderRequestSnapshot(request: ModelRequest): ProviderRequestSnapshot {
  return Object.freeze({
    messages: freezeDeep(toPrepareProviderRequestMessages(request.messages)),
    stream: request.stream,
    ...(request.systemPrompt === undefined ? {} : { systemPrompt: request.systemPrompt }),
    ...(request.tools ? { tools: freezeDeep(structuredClone(request.tools)) } : {}),
  });
}
