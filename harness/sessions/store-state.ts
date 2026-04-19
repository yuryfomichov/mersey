import { createEmptyModelUsage, type ModelUsage } from '../runtime/models/types.js';
import type { Message, StoredSessionState } from '../runtime/sessions/types.js';

export function cloneMessage<T extends Message>(message: T): T {
  return structuredClone(message);
}

export function cloneStoredSession(session: StoredSessionState): StoredSessionState {
  return {
    contextSize: session.contextSize,
    createdAt: session.createdAt,
    id: session.id,
    messages: session.messages.map((message) => cloneMessage(message)),
    usage: structuredClone(session.usage),
  };
}

function getMessageUsage(message: Message): ModelUsage {
  return message.role === 'assistant' && message.usage ? message.usage : createEmptyModelUsage();
}

function getUsageTotalTokens(usage: ModelUsage): number {
  return usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens + usage.outputTokens;
}

function addUsage(left: ModelUsage, right: ModelUsage): ModelUsage {
  return {
    cacheWriteInputTokens: left.cacheWriteInputTokens + right.cacheWriteInputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    uncachedInputTokens: left.uncachedInputTokens + right.uncachedInputTokens,
  };
}

export function commitSessionTurn(session: StoredSessionState, turnMessages: readonly Message[]): StoredSessionState {
  const nextMessages = session.messages.map((message) => cloneMessage(message));
  let nextUsage = structuredClone(session.usage);
  let nextContextSize = session.contextSize;

  for (const turnMessage of turnMessages) {
    const message = cloneMessage(turnMessage);
    nextMessages.push(message);
    nextUsage = addUsage(nextUsage, getMessageUsage(message));

    if (message.role === 'assistant' && message.usage) {
      nextContextSize = getUsageTotalTokens(message.usage);
    }
  }

  return {
    contextSize: nextContextSize,
    createdAt: session.createdAt,
    id: session.id,
    messages: nextMessages,
    usage: nextUsage,
  };
}
