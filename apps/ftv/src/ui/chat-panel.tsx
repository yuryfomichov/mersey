import { Box, Text } from 'ink';
import React from 'react';

import type { Message } from '../../../../harness/index.js';
import { MessageList } from './message-list.js';
import { StreamingOutput } from './streaming-output.js';
import { ThinkingIndicator } from './thinking-indicator.js';

interface ChatPanelProps {
  currentTool: string | null;
  hasMoreMessages: boolean;
  isThinking: boolean;
  messages: Message[];
  streamingContent: string;
}

export function ChatPanel({ currentTool, hasMoreMessages, isThinking, messages, streamingContent }: ChatPanelProps) {
  return (
    <Box
      borderColor='cyan'
      borderStyle='round'
      flexDirection='column'
      flexGrow={1}
      flexShrink={1}
      minHeight={0}
      overflow='hidden'
      paddingX={1}
    >
      {hasMoreMessages ? <Text dimColor>... {messages.length - 10} earlier messages</Text> : null}
      <Box flexDirection='column' flexGrow={1} flexShrink={1} minHeight={0} overflow='hidden'>
        <MessageList messages={messages.slice(-10)} />
        {streamingContent ? <StreamingOutput content={streamingContent} /> : null}
        {isThinking ? <ThinkingIndicator tool={currentTool} /> : null}
      </Box>
    </Box>
  );
}