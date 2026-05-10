import { Box, Text } from 'ink';
import React from 'react';

interface StatusBarProps {
  startupNotice?: string;
  turnCount: number;
  toolSummary?: string;
  toolName?: string;
}

export function StatusBar({ startupNotice, turnCount, toolName, toolSummary }: StatusBarProps) {
  return (
    <Box flexDirection='column'>
      {startupNotice ? (
        <Text color='yellow' wrap='truncate-end'>
          {startupNotice}
        </Text>
      ) : null}
      <Box>
        <Text dimColor>turn: {turnCount} | q to quit</Text>
        {toolName && (
          <>
            <Text dimColor> | </Text>
            <Text color='yellow'>
              waiting: {toolName}
              {toolSummary ? ` ${toolSummary}` : ''} (y/n)
            </Text>
          </>
        )}
      </Box>
    </Box>
  );
}
