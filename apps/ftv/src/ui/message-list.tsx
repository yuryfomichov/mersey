import { Box } from 'ink';
import React from 'react';

import type { Message } from '../../../../harness/index.js';
import { MessageItem } from './message-item.js';
import { getMessageKey } from './utils.js';

interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  return (
    <Box flexDirection='column' gap={0}>
      {messages.map((msg, i) => (
        <Box key={getMessageKey(msg, i)} flexDirection='column' marginY={0}>
          <MessageItem msg={msg} />
        </Box>
      ))}
    </Box>
  );
}