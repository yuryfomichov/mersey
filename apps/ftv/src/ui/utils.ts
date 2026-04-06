import type { Message } from '../../../../harness/index.js';

export interface ChatLine {
  key: string;
  text: string;
  color?: 'cyan' | 'green' | 'yellow';
  dimColor?: boolean;
}

interface BuildChatLinesOptions {
  contentWidth: number;
  currentTool: string | null;
  isThinking: boolean;
  messages: Message[];
  streamingContent: string;
}

export function compactMessageText(content: string): string {
  return content.replace(/\r\n?/g, '\n').trim();
}

export function getMessageKey(message: Message, index: number): string {
  if (message.role === 'tool') {
    return `${message.role}:${message.createdAt}:${message.toolCallId}:${index}`;
  }

  return `${message.role}:${message.createdAt}:${index}`;
}

export function buildChatLines({ contentWidth, currentTool, isThinking, messages, streamingContent }: BuildChatLinesOptions): ChatLine[] {
  const width = Math.max(1, contentWidth);
  const lines = messages.flatMap((message, index) => buildMessageLines(message, index, width));

  if (streamingContent) {
    const streamingLines = wrapPrefixedText('', compactMessageText(streamingContent), width, '');
    const lastIndex = streamingLines.length - 1;

    streamingLines.forEach((line, index) => {
      lines.push({
        key: `stream:${index}`,
        text: index === lastIndex ? `${line}▌` : line,
        color: 'cyan',
      });
    });
  }

  if (isThinking) {
    lines.push({
      key: `thinking:${lines.length}`,
      text: `● ${currentTool ? `executing ${currentTool}...` : 'thinking...'}`,
      dimColor: true,
    });
  }

  return lines;
}

function buildMessageLines(message: Message, index: number, width: number): ChatLine[] {
  const keyBase = getMessageKey(message, index);

  if (message.role === 'user') {
    return wrapPrefixedText('you: ', compactMessageText(message.content), width, ' '.repeat(5)).map((text, lineIndex) => ({
      key: `${keyBase}:${lineIndex}`,
      text,
      color: 'green',
    }));
  }

  if (message.role === 'assistant') {
    return wrapPrefixedText('', compactMessageText(message.content), width, '').map((text, lineIndex) => ({
      key: `${keyBase}:${lineIndex}`,
      text,
      color: 'cyan',
    }));
  }

  if (message.role === 'tool') {
    return [];
  }

  return [];
}

function wrapPrefixedText(prefix: string, content: string, width: number, continuationPrefix: string): string[] {
  if (width <= prefix.length) {
    return [`${prefix}${content}`.slice(0, width)];
  }

  const firstLineWidth = Math.max(1, width - prefix.length);
  const continuationWidth = Math.max(1, width - continuationPrefix.length);
  const wrapped = (content || ' ')
    .split('\n')
    .flatMap((line) => wrapText(line, firstLineWidth, continuationWidth));

  return wrapped.map((line, index) => `${index === 0 ? prefix : continuationPrefix}${line}`);
}

function wrapText(content: string, firstLineWidth: number, continuationWidth: number): string[] {
  if (!content.trim()) {
    return [''];
  }

  const words = content.split(' ');
  const lines: string[] = [];
  let current = '';
  let currentWidth = firstLineWidth;

  for (const word of words) {
    let remaining = word;

    while (remaining) {
      if (!current) {
        if (remaining.length <= currentWidth) {
          current = remaining;
          remaining = '';
          continue;
        }

        lines.push(remaining.slice(0, currentWidth));
        remaining = remaining.slice(currentWidth);
        currentWidth = continuationWidth;
        continue;
      }

      if (current.length + 1 + remaining.length <= currentWidth) {
        current = `${current} ${remaining}`;
        remaining = '';
        continue;
      }

      lines.push(current);
      current = '';
      currentWidth = continuationWidth;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
}
