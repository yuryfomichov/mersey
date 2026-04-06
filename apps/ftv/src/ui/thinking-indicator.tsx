import { Box, Text } from 'ink';
import React from 'react';

interface ThinkingIndicatorProps {
  tool: string | null;
}

export function ThinkingIndicator({ tool }: ThinkingIndicatorProps) {
  return (
    <Box flexDirection='row' gap={1}>
      <Text dimColor>● </Text>
      <Text dimColor>{tool ? `executing ${tool}...` : 'thinking...'}</Text>
    </Box>
  );
}
