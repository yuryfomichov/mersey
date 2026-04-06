import { Box, Text } from 'ink';
import React from 'react';

import type { UsageState } from '../app/types.js';

interface HeaderRowProps {
  cache: boolean;
  debug: boolean;
  model: string | null;
  providerName: string;
  sessionId: string;
  sessionStoreLabel: string;
  usage: UsageState;
}

export function HeaderRow({ cache, debug, model, providerName, sessionId, sessionStoreLabel, usage }: HeaderRowProps) {
  const totalInput = usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens;
  const storeLabel = sessionStoreLabel.replace('session store: ', '');

  const left1 = `provider: ${providerName}${model ? ` | model: ${model}` : ''}`;
  const left2 = `mode: ${cache ? 'cache on' : 'cache off'} | debug: ${debug ? 'on' : 'off'}`;
  const left3 = `session: ${sessionId} | store: ${storeLabel}`;

  const right1 = `usage: ${totalInput} in / ${usage.outputTokens} out`;
  const right2 = `cache: no ${usage.uncachedInputTokens} | read ${usage.cachedInputTokens} | write ${usage.cacheWriteInputTokens}`;
  const right3 = `context: ${usage.contextSize} tokens`;

  return (
    <Box borderColor='magenta' borderStyle='round' justifyContent='space-between' paddingX={1}>
      <Box flexDirection='column'>
        <Text wrap='truncate-end'>{left1}</Text>
        <Text wrap='truncate-end'>{left2}</Text>
        <Text wrap='truncate-end'>{left3}</Text>
      </Box>
      <Box alignItems='flex-end' flexDirection='column'>
        <Text wrap='truncate-start'>{right1}</Text>
        <Text dimColor wrap='truncate-start'>
          {right2}
        </Text>
        <Text wrap='truncate-start'>{right3}</Text>
      </Box>
    </Box>
  );
}
