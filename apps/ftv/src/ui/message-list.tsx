import { Box, Text } from 'ink';
import React from 'react';

import type { Message } from '../../../../harness/types.js';
import { buildChatLines } from './utils.js';

interface MessageListProps {
  contentWidth: number;
  currentTool: string | null;
  isThinking: boolean;
  maxLines: number;
  messages: Message[];
  streamingContent: string;
}

export function MessageList({
  contentWidth,
  currentTool,
  isThinking,
  maxLines,
  messages,
  streamingContent,
}: MessageListProps) {
  const lines = buildChatLines({
    contentWidth,
    currentTool,
    isThinking,
    messages,
    streamingContent,
  });

  const maxVisibleContentLines = Math.max(1, maxLines - (lines.length > maxLines ? 1 : 0));
  const hiddenLineCount = Math.max(0, lines.length - maxVisibleContentLines);
  const visibleLines = hiddenLineCount > 0 ? lines.slice(-maxVisibleContentLines) : lines;

  return (
    <Box flexDirection='column' gap={0}>
      {hiddenLineCount > 0 ? <Text dimColor>... {hiddenLineCount} lines above</Text> : null}
      {visibleLines.map((line) => (
        <Text key={line.key} color={line.color} dimColor={line.dimColor} wrap='truncate-end'>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}
