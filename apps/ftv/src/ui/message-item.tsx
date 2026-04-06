import { Text } from 'ink';
import React from 'react';

import type { Message } from '../../../../harness/index.js';
import { compactMessageText } from './utils.js';

interface MessageItemProps {
  msg: Message;
}

export function MessageItem({ msg }: MessageItemProps) {
  const content = compactMessageText(msg.content);

  if (msg.role === 'user') {
    return (
      <Text color='green' wrap='truncate-end'>
        you: {content}
      </Text>
    );
  }
  if (msg.role === 'assistant') {
    return (
      <Text color='cyan' wrap='truncate-end'>
        {content}
      </Text>
    );
  }
  if (msg.role === 'tool') {
    const preview = content.length > 80 ? content.slice(0, 80) + '...' : content;
    return (
      <Text dimColor wrap='truncate-end'>
        tool [{msg.name}]: {preview}
      </Text>
    );
  }
  return null;
}