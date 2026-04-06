import { Text } from 'ink';
import React from 'react';

import { compactMessageText } from './utils.js';

interface StreamingOutputProps {
  content: string;
}

export function StreamingOutput({ content }: StreamingOutputProps) {
  return content ? (
    <Text color='cyan' wrap='truncate-end'>
      {compactMessageText(content)}
      <Text color='cyan' dimColor>
        ▌
      </Text>
    </Text>
  ) : null;
}
