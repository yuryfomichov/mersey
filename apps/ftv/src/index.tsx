import React, { useState, useEffect } from 'react';
import { render, Box, Text, useInput } from 'ink';
import { Session } from '../../../harness/src/sessions/session.js';
import { MemorySessionStore } from '../../../harness/src/sessions/memory-store.js';
import { createHarness } from '../../../harness/src/harness.js';
import { ReadFileTool } from '../../../harness/src/tools/read-file.js';
import { WriteFileTool } from '../../../harness/src/tools/write-file.js';
import { EditFileTool } from '../../../harness/src/tools/edit-file.js';
import { RunCommandTool } from '../../../harness/src/tools/run-command.js';
import { getProviderDefinition } from '../../../apps/cli/src/provider-config.js';
import type { Harness } from '../../../harness/src/harness.js';
import type { HarnessEvent } from '../../../harness/src/events/types.js';
import type { Message } from '../../../harness/src/sessions/types.js';

type AppState = {
  messages: Message[];
  streamingContent: string;
  isThinking: boolean;
  currentTool: string | null;
  turnCount: number;
  input: string;
};

const Logo = () => (
  <Box marginY={1}>
    <Text bold color="#FF1493">FEEL THE VIBES</Text>
  </Box>
);

const VibingHeader = ({ model }: { model: string }) => (
  <Box marginY={1} flexDirection="column">
    <Text dimColor>vibing with </Text>
    <Text color="cyan">OPENAI </Text>
    <Text dimColor>model: {model}</Text>
  </Box>
);

const MessageItem = ({ msg }: { msg: Message }) => {
  if (msg.role === 'user') {
    return <Text color="green">you: {msg.content}</Text>;
  }
  if (msg.role === 'assistant') {
    return <Text color="cyan">{msg.content}</Text>;
  }
  if (msg.role === 'tool') {
    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
    return <Text dimColor>tool [{msg.name}]: {preview}</Text>;
  }
  return null;
};

const MessageList = ({ messages }: { messages: Message[] }) => (
  <Box flexDirection="column" gap={0}>
    {messages.map((msg, i) => (
      <Box key={i} flexDirection="column" marginY={0}>
        <MessageItem msg={msg} />
      </Box>
    ))}
  </Box>
);

const StreamingOutput = ({ content }: { content: string }) => (
  content ? (
    <Text color="cyan">
      {content}<Text color="cyan" dimColor>▌</Text>
    </Text>
  ) : null
);

const ThinkingIndicator = ({ tool }: { tool: string | null }) => (
  <Box flexDirection="row" gap={1}>
    <Text dimColor>● </Text>
    <Text dimColor>
      {tool ? `executing ${tool}...` : 'thinking...'}
    </Text>
  </Box>
);

const StatusBar = ({ turnCount }: { turnCount: number }) => (
  <Box marginY={0}>
    <Text dimColor>turn: {turnCount} | q to quit</Text>
  </Box>
);

interface TuiAppProps {
  sessionId?: string;
}

const TuiApp = ({ sessionId = 'ftv-session' }: TuiAppProps) => {
  const [state, setState] = useState<AppState>({
    messages: [],
    streamingContent: '',
    isThinking: false,
    currentTool: null,
    turnCount: 0,
    input: '',
  });

  const [harness, setHarness] = useState<Harness | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const store = new MemorySessionStore();
    const session = new Session({ id: sessionId, store });

    const providerDef = getProviderDefinition('openai');

    const h = createHarness({
      debug: false,
      provider: providerDef,
      session,
      toolExecutionPolicy: {
        maxToolResultBytes: 16 * 1024,
        workspaceRoot: process.cwd(),
      },
      tools: [
        new ReadFileTool(),
        new WriteFileTool(),
        new EditFileTool(),
        new RunCommandTool({
          commandAllowlist: ['git', 'ls', 'pwd', 'cat', 'head', 'grep', 'find', 'wc', 'sort', 'uniq'],
          defaultTimeoutMs: 5000,
          maxOutputBytes: 16 * 1024,
          maxTimeoutMs: 15000,
        }),
      ],
    });

    setHarness(h);

    const unsubscribe = h.subscribe((event: HarnessEvent) => {
      switch (event.type) {
        case 'turn_started':
          setState((s) => ({
            ...s,
            isThinking: true,
            streamingContent: '',
          }));
          break;
        case 'tool_started':
          setState((s) => ({ ...s, currentTool: event.toolName }));
          break;
        case 'tool_finished':
          setState((s) => ({ ...s, currentTool: null }));
          break;
        case 'turn_finished':
          setState((s) => ({
            ...s,
            isThinking: false,
            streamingContent: '',
            turnCount: s.turnCount + 1,
          }));
          break;
        case 'turn_failed':
          setState((s) => ({
            ...s,
            isThinking: false,
            streamingContent: `Error: ${event.errorMessage}`,
          }));
          break;
      }
    });

    setReady(true);

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      process.exit(0);
    }

    if (key.return && state.input.trim() && !state.isThinking && harness) {
      const msg = state.input;
      setState((s) => ({ 
        ...s, 
        input: '', 
        isThinking: true,
        messages: [...s.messages, { role: 'user' as const, content: msg, createdAt: new Date().toISOString() }]
      }));

      (async () => {
        try {
          for await (const chunk of harness.streamMessage(msg)) {
            switch (chunk.type) {
              case 'assistant_delta':
                setState((s) => ({
                  ...s,
                  streamingContent: s.streamingContent + chunk.delta,
                }));
                break;
              case 'final_message':
                setState((s) => ({
                  ...s,
                  messages: [...s.messages, chunk.message],
                  streamingContent: '',
                  isThinking: false,
                }));
                break;
            }
          }
        } catch (err) {
          setState((s) => ({
            ...s,
            streamingContent: `Error: ${err instanceof Error ? err.message : String(err)}`,
            isThinking: false,
          }));
        }
      })();
      return;
    }

    if (key.backspace || key.delete) {
      setState((s) => ({ ...s, input: s.input.slice(0, -1) }));
    } else if (input.length === 1 && !key.ctrl && !key.meta) {
      setState((s) => ({ ...s, input: s.input + input }));
    }
  });

  const visibleMessages = state.messages.slice(-10);
  const hasMoreMessages = state.messages.length > 10;

  return (
    <Box flexDirection="column">
      <Logo />
      <VibingHeader model="GPT-5.4-mini ultra turbo" />

      <Box flexDirection="column" marginY={1} flexGrow={1}>
        {hasMoreMessages && (
          <Text dimColor>... {state.messages.length - 10} earlier messages</Text>
        )}
        <MessageList messages={visibleMessages} />
        {state.streamingContent && <StreamingOutput content={state.streamingContent} />}
        {state.isThinking && <ThinkingIndicator tool={state.currentTool} />}
      </Box>

      <StatusBar turnCount={state.turnCount} />

      <Box marginTop={1}>
        <Text color="green">&gt; </Text>
        <Text color="white">{state.input}</Text>
        <Text dimColor>_</Text>
      </Box>
      <Box marginTop={0}>
        {!ready && <Text dimColor>initializing...</Text>}
        {ready && !state.isThinking && !state.input && <Text dimColor>type your vibes and press Enter...</Text>}
        {ready && state.isThinking && <Text dimColor>收到 vibes, thinking...</Text>}
      </Box>
    </Box>
  );
};

function parseArgs(): { sessionId?: string } {
  const args = process.argv.slice(2);
  let sessionId: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--session-id' && args[i + 1]) {
      sessionId = args[i + 1];
      i++;
    } else if (args[i].startsWith('--session-id=')) {
      sessionId = args[i].slice('--session-id='.length);
    }
  }

  return { sessionId };
}

const { sessionId } = parseArgs();

render(<TuiApp sessionId={sessionId} />);
