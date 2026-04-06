import { Box } from 'ink';
import React from 'react';

import type { Message } from '../../../../harness/index.js';
import { MessageList } from './message-list.js';

interface ChatPanelProps {
  contentWidth: number;
  currentTool: string | null;
  isThinking: boolean;
  maxBodyLines: number;
  messages: Message[];
  streamingContent: string;
}

export function ChatPanel({ contentWidth, currentTool, isThinking, maxBodyLines, messages, streamingContent }: ChatPanelProps) {
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
      <Box flexDirection='column' flexGrow={1} flexShrink={1} minHeight={0} overflow='hidden'>
        <MessageList
          contentWidth={contentWidth}
          currentTool={currentTool}
          isThinking={isThinking}
          maxLines={maxBodyLines}
          messages={messages}
          streamingContent={streamingContent}
        />
      </Box>
    </Box>
  );
}
