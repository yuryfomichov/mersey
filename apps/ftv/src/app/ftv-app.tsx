import { Box, useStdout } from 'ink';
import { useInput } from 'ink';
import React from 'react';

import { ChatPanel } from '../ui/chat-panel.js';
import { HeaderRow } from '../ui/header-row.js';
import { InputPanel } from '../ui/input-panel.js';
import { Logo } from '../ui/logo.js';
import { StatusBar } from '../ui/status-bar.js';
import { useFtvController } from './controller/use-ftv-controller.js';
import { type TuiAppProps } from './types.js';

const MESSAGE_WINDOW_SIZE = 10;

export function FtvApp({
  cache,
  debug,
  providerName,
  sessionId,
  sessionStoreDefinition,
  sessionStoreLabel,
}: TuiAppProps) {
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;

  const { state, actions, exit } = useFtvController({
    cache,
    debug,
    providerName,
    sessionId,
    sessionStoreDefinition,
  });

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      exit();
      return;
    }

    if ((input === 'y' || input === 'Y') && state.pendingApproval) {
      actions.approveTool();
      return;
    }

    if ((input === 'n' || input === 'N') && state.pendingApproval) {
      actions.denyTool();
      return;
    }

    if (key.return && state.ready && state.input.trim() && !state.isThinking) {
      actions.submitMessage();
      return;
    }

    if (key.backspace || key.delete) {
      actions.setInput(state.input.slice(0, -1));
    } else if (input.length === 1 && !key.ctrl && !key.meta) {
      actions.setInput(state.input + input);
    }
  });

  const hasMoreMessages = state.messages.length > MESSAGE_WINDOW_SIZE;

  return (
    <Box flexDirection='column' height={rows}>
      <Box flexDirection='column' flexShrink={0} marginBottom={1}>
        <Logo />
        <HeaderRow
          cache={cache}
          debug={debug}
          model={state.providerModel}
          providerName={providerName}
          sessionId={sessionId}
          sessionStoreLabel={sessionStoreLabel}
          usage={state.usage}
        />
      </Box>

      <ChatPanel
        currentTool={state.currentTool}
        hasMoreMessages={hasMoreMessages}
        isThinking={state.isThinking}
        messages={state.messages}
        streamingContent={state.streamingContent}
      />

      <Box flexDirection='column' flexShrink={0} marginTop={1}>
        <StatusBar turnCount={state.turnCount} toolName={state.pendingApproval?.toolName} />
        <InputPanel input={state.input} isThinking={state.isThinking} ready={state.ready} />
      </Box>
    </Box>
  );
}