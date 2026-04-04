import { Box, render, Text, useInput, useStdout } from 'ink';
import React, { useEffect, useState } from 'react';

import {
  createHarness,
  type Harness,
  type HarnessEvent,
  type Message,
  type ProviderName,
} from '../../../harness/index.js';
import { getBooleanFlag, getProviderName, getSessionId } from '../../helpers/cli/args.js';
import { createDefaultTools, getProviderModel, getToolExecutionPolicy } from '../../helpers/cli/harness-config.js';
import { getProviderDefinition } from '../../helpers/cli/provider-config.js';
import {
  createSession,
  formatSessionStore,
  getSessionStoreDefinition,
  type SessionStoreDefinition,
} from '../../helpers/cli/session-store.js';

type AppState = {
  messages: Message[];
  streamingContent: string;
  isThinking: boolean;
  currentTool: string | null;
  turnCount: number;
  input: string;
};

type UsageState = {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  contextSize: number;
  outputTokens: number;
  uncachedInputTokens: number;
};

const Logo = () => (
  <Box marginBottom={1}>
    <Text bold color='#FF1493'>
      Feel The Vibes
    </Text>
  </Box>
);

const HeaderRow = ({
  cache,
  debug,
  providerName,
  model,
  sessionId,
  sessionStoreLabel,
  usage,
}: {
  cache: boolean;
  debug: boolean;
  model: string | null;
  providerName: string;
  sessionId: string;
  sessionStoreLabel: string;
  usage: UsageState;
}) => {
  const totalInput = usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens;
  const storeLabel = sessionStoreLabel.replace('session store: ', '');

  const left1 = `provider: ${providerName}${model ? ` | model: ${model}` : ''}`;
  const left2 = `mode: ${cache ? 'cache on' : 'cache off'} | debug: ${debug ? 'on' : 'off'}`;
  const left3 = `session: ${sessionId} | store: ${storeLabel}`;

  const right1 = `usage: ${totalInput} in / ${usage.outputTokens} out`;
  const right2 = `uncached ${usage.uncachedInputTokens} | cached ${usage.cachedInputTokens} | cw ${usage.cacheWriteInputTokens}`;
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
};

const MessageItem = ({ msg }: { msg: Message }) => {
  if (msg.role === 'user') {
    return <Text color='green'>you: {msg.content}</Text>;
  }
  if (msg.role === 'assistant') {
    return <Text color='cyan'>{msg.content}</Text>;
  }
  if (msg.role === 'tool') {
    const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
    return (
      <Text dimColor>
        tool [{msg.name}]: {preview}
      </Text>
    );
  }
  return null;
};

const MessageList = ({ messages }: { messages: Message[] }) => (
  <Box flexDirection='column' gap={0}>
    {messages.map((msg, i) => (
      <Box key={i} flexDirection='column' marginY={0}>
        <MessageItem msg={msg} />
      </Box>
    ))}
  </Box>
);

const StreamingOutput = ({ content }: { content: string }) =>
  content ? (
    <Text color='cyan'>
      {content}
      <Text color='cyan' dimColor>
        ▌
      </Text>
    </Text>
  ) : null;

const ThinkingIndicator = ({ tool }: { tool: string | null }) => (
  <Box flexDirection='row' gap={1}>
    <Text dimColor>● </Text>
    <Text dimColor>{tool ? `executing ${tool}...` : 'thinking...'}</Text>
  </Box>
);

const StatusBar = ({ turnCount }: { turnCount: number }) => (
  <Box>
    <Text dimColor>turn: {turnCount} | q to quit</Text>
  </Box>
);

const ChatPanel = ({
  contentHeight,
  currentTool,
  hasMoreMessages,
  isThinking,
  messages,
  streamingContent,
}: {
  contentHeight: number;
  currentTool: string | null;
  hasMoreMessages: boolean;
  isThinking: boolean;
  messages: Message[];
  streamingContent: string;
}) => (
  <Box borderColor='cyan' borderStyle='round' flexDirection='column' height={contentHeight} paddingX={1}>
    {hasMoreMessages ? <Text dimColor>... {messages.length - 10} earlier messages</Text> : null}
    <Box flexDirection='column' flexGrow={1} overflow='hidden'>
      <MessageList messages={messages.slice(-10)} />
      {streamingContent ? <StreamingOutput content={streamingContent} /> : null}
      {isThinking ? <ThinkingIndicator tool={currentTool} /> : null}
    </Box>
  </Box>
);

const InputPanel = ({ input, isThinking, ready }: { input: string; isThinking: boolean; ready: boolean }) => (
  <Box borderColor='green' borderStyle='round' flexDirection='column' paddingX={1}>
    <Box>
      <Text color='green'>&gt; </Text>
      <Text>{input || ' '}</Text>
      <Text dimColor>_</Text>
    </Box>
    {!ready ? <Text dimColor>initializing...</Text> : null}
    {ready && !isThinking && !input ? <Text dimColor>type your vibes and press Enter...</Text> : null}
    {ready && isThinking ? <Text dimColor>received vibes, thinking...</Text> : null}
  </Box>
);

const HEADER_HEIGHT = 7;
const FOOTER_HEIGHT = 5;

interface TuiAppProps {
  cache: boolean;
  debug: boolean;
  providerName: ProviderName;
  sessionId: string;
  sessionStoreDefinition: SessionStoreDefinition;
  sessionStoreLabel: string;
}

const FTV_COMMAND_ALLOWLIST = ['git', 'ls', 'pwd', 'cat', 'head', 'grep', 'find', 'wc', 'sort', 'uniq'] as const;

const TuiApp = ({ cache, debug, providerName, sessionId, sessionStoreDefinition, sessionStoreLabel }: TuiAppProps) => {
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;
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
  const [providerModel, setProviderModel] = useState<string | null>(null);
  const [usage, setUsage] = useState<UsageState>({
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    contextSize: 0,
    outputTokens: 0,
    uncachedInputTokens: 0,
  });

  const chatHeight = Math.max(8, rows - HEADER_HEIGHT - FOOTER_HEIGHT);

  useEffect(() => {
    const session = createSession(sessionStoreDefinition, sessionId);
    const providerDef = getProviderDefinition(providerName, process.env, cache);

    const h = createHarness({
      debug,
      provider: providerDef,
      session,
      toolExecutionPolicy: getToolExecutionPolicy(),
      tools: createDefaultTools({ commandAllowlist: FTV_COMMAND_ALLOWLIST }),
    });

    setHarness(h);
    setProviderModel(getProviderModel(providerDef));

    let disposed = false;

    const updateUsage = async () => {
      const [usageSnapshot, contextSize] = await Promise.all([h.session.getUsage(), h.session.getContextSize()]);

      if (disposed) {
        return;
      }

      setUsage({
        cachedInputTokens: usageSnapshot.cachedInputTokens,
        cacheWriteInputTokens: usageSnapshot.cacheWriteInputTokens,
        contextSize,
        outputTokens: usageSnapshot.outputTokens,
        uncachedInputTokens: usageSnapshot.uncachedInputTokens,
      });
    };

    void h.session.ensure().then(updateUsage);

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
          void updateUsage();
          break;
        case 'turn_failed':
          setState((s) => ({
            ...s,
            isThinking: false,
            streamingContent: `Error: ${event.errorMessage}`,
          }));
          void updateUsage();
          break;
      }
    });

    setReady(true);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [cache, debug, providerName, sessionId, sessionStoreDefinition]);

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
        messages: [...s.messages, { role: 'user' as const, content: msg, createdAt: new Date().toISOString() }],
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

  const hasMoreMessages = state.messages.length > 10;

  return (
    <Box flexDirection='column' height={rows}>
      <Box flexDirection='column' marginBottom={1}>
        <Logo />
        <HeaderRow
          cache={cache}
          debug={debug}
          model={providerModel}
          providerName={providerName}
          sessionId={sessionId}
          sessionStoreLabel={sessionStoreLabel}
          usage={usage}
        />
      </Box>

      <ChatPanel
        contentHeight={chatHeight}
        currentTool={state.currentTool}
        hasMoreMessages={hasMoreMessages}
        isThinking={state.isThinking}
        messages={state.messages}
        streamingContent={state.streamingContent}
      />

      <Box flexDirection='column' marginTop={1}>
        <StatusBar turnCount={state.turnCount} />
        <InputPanel input={state.input} isThinking={state.isThinking} ready={ready} />
      </Box>
    </Box>
  );
};

function parseArgs(): {
  cache: boolean;
  debug: boolean;
  providerName: ProviderName;
  sessionId: string;
  sessionStoreDefinition: SessionStoreDefinition;
  sessionStoreLabel: string;
} {
  const args = process.argv.slice(2);
  const sessionStoreDefinition = getSessionStoreDefinition(args);

  return {
    cache: getBooleanFlag(args, '--cache'),
    debug: getBooleanFlag(args, '--debug'),
    providerName: getProviderName(args, 'openai'),
    sessionId: getSessionId(args) ?? 'ftv-session',
    sessionStoreDefinition,
    sessionStoreLabel: formatSessionStore(sessionStoreDefinition),
  };
}

const { cache, debug, providerName, sessionId, sessionStoreDefinition, sessionStoreLabel } = parseArgs();

render(
  <TuiApp
    cache={cache}
    debug={debug}
    providerName={providerName}
    sessionId={sessionId}
    sessionStoreDefinition={sessionStoreDefinition}
    sessionStoreLabel={sessionStoreLabel}
  />,
);
