import { Box, Text } from 'ink';
import React from 'react';

interface StatusBarProps {
  turnCount: number;
  toolSummary?: string;
  toolName?: string;
}

export function StatusBar({ turnCount, toolName, toolSummary }: StatusBarProps) {
  return (
    <Box>
      <Text dimColor>turn: {turnCount} | q to quit</Text>
      {toolName && (
        <>
          <Text dimColor> | </Text>
          <Text color='yellow'>waiting: {toolName}{toolSummary ? ` ${toolSummary}` : ''} (y/n)</Text>
        </>
      )}
    </Box>
  );
}
