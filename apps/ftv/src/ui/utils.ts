import type { Message } from '../../../../harness/index.js';

export function compactMessageText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

export function getMessageKey(message: Message, index: number): string {
  if (message.role === 'tool') {
    return `${message.role}:${message.createdAt}:${message.toolCallId}:${index}`;
  }

  return `${message.role}:${message.createdAt}:${index}`;
}