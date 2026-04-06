import { Box, Text } from 'ink';
import React from 'react';

interface InputPanelProps {
  input: string;
  isThinking: boolean;
  ready: boolean;
}

export function InputPanel({ input, isThinking, ready }: InputPanelProps) {
  return (
    <Box borderColor='green' borderStyle='round' flexDirection='column' paddingX={1}>
      <Box>
        <Text color='green'>&gt; </Text>
        <Text wrap='truncate-end'>{input || ' '}</Text>
        <Text dimColor>_</Text>
        {!ready ? <Text dimColor> initializing...</Text> : null}
        {ready && !isThinking && !input ? <Text dimColor> type your vibes and press Enter...</Text> : null}
        {ready && isThinking ? <Text dimColor> received vibes, thinking...</Text> : null}
      </Box>
    </Box>
  );
}
