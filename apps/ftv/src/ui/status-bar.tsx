import { Box, Text } from 'ink';
import React from 'react';

interface StatusBarProps {
  turnCount: number;
  toolName?: string;
}

export function StatusBar({ turnCount, toolName }: StatusBarProps) {
  return (
    <Box>
      <Text dimColor>turn: {turnCount} | q to quit</Text>
      {toolName && (
        <>
          <Text dimColor> | </Text>
          <Text color='yellow'>waiting: {toolName} (y/n)</Text>
        </>
      )}
    </Box>
  );
}
