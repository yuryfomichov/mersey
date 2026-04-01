import type { ModelToolCall } from './models/index.js';
import type { Message } from './sessions/index.js';

export type TurnProgress = {
  iteration: number;
  toolIterations: number;
  totalToolCalls: number;
};

export function findToolCall(messages: Message[], toolCallId: string): ModelToolCall | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    const toolCall = message.toolCalls.find((candidate) => candidate.id === toolCallId);

    if (toolCall) {
      return toolCall;
    }
  }

  return null;
}

export function getCurrentTurnProgress(messages: Message[]): TurnProgress {
  let lastUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }

  return messages.slice(lastUserIndex + 1).reduce(
    (progress, message) => {
      if (message.role !== 'assistant') {
        return progress;
      }

      progress.iteration += 1;

      if (message.toolCalls?.length) {
        progress.toolIterations += 1;
        progress.totalToolCalls += message.toolCalls.length;
      }

      return progress;
    },
    {
      iteration: 0,
      toolIterations: 0,
      totalToolCalls: 0,
    },
  );
}
