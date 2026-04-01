export type HarnessEventBase = {
  id: string;
  sessionId: string;
  timestamp: string;
  turnId: string;
  type:
    | 'turn_started'
    | 'provider_requested'
    | 'provider_text_delta'
    | 'provider_responded'
    | 'tool_requested'
    | 'tool_started'
    | 'tool_finished'
    | 'turn_finished'
    | 'turn_failed';
};

export type TurnStartedEvent = HarnessEventBase & {
  type: 'turn_started';
  userMessageLength: number;
};

export type ProviderRequestedEvent = HarnessEventBase & {
  type: 'provider_requested';
  iteration: number;
  messageCount: number;
  messageCountsByRole: {
    assistant: number;
    tool: number;
    user: number;
  };
  model: string;
  providerName: string;
  toolDefinitionCount: number;
  toolDefinitionNames: string[];
};

export type ProviderRespondedEvent = HarnessEventBase & {
  type: 'provider_responded';
  durationMs: number;
  iteration: number;
  model: string;
  providerName: string;
  textLength: number;
  toolCallCount: number;
  toolCallNames: string[];
  usedFallbackText: boolean;
};

export type ProviderTextDeltaEvent = HarnessEventBase & {
  type: 'provider_text_delta';
  delta: string;
  deltaLength: number;
  iteration: number;
  model: string;
  providerName: string;
};

export type SafeCommandArgSummary = {
  digest: string;
  length: number;
  present: true;
};

export type SafePathArgSummary = {
  basename: string;
  digest: string;
  length: number;
  looksAbsolute: boolean;
  present: true;
};

export type DebugToolArgs = {
  args?: string[];
  command?: string;
  cwd?: string;
  path?: string;
};

export type SafeToolArgs = {
  command?: SafeCommandArgSummary;
  cwd?: SafePathArgSummary;
  path?: SafePathArgSummary;
};

export type ToolRequestedEvent = HarnessEventBase & {
  debugArgs?: DebugToolArgs;
  type: 'tool_requested';
  iteration: number;
  safeArgs: SafeToolArgs;
  toolCallId: string;
  toolName: string;
};

export type ToolStartedEvent = HarnessEventBase & {
  type: 'tool_started';
  iteration: number;
  toolCallId: string;
  toolName: string;
};

export type ToolFinishedEvent = HarnessEventBase & {
  type: 'tool_finished';
  durationMs: number;
  isError: boolean;
  iteration: number;
  resultContentLength: number;
  resultDataKeys: string[];
  toolCallId: string;
  toolName: string;
};

export type TurnFinishedEvent = HarnessEventBase & {
  type: 'turn_finished';
  durationMs: number;
  finalAssistantLength: number;
  totalIterations: number;
  totalToolCalls: number;
};

export type TurnFailedEvent = HarnessEventBase & {
  type: 'turn_failed';
  durationMs: number;
  errorMessage: string;
  errorType: 'provider' | 'tool' | 'runtime';
  iteration: number;
};

export type HarnessEvent =
  | ProviderRequestedEvent
  | ProviderRespondedEvent
  | ProviderTextDeltaEvent
  | ToolFinishedEvent
  | ToolRequestedEvent
  | ToolStartedEvent
  | TurnFailedEvent
  | TurnFinishedEvent
  | TurnStartedEvent;

export type HarnessEventListener = (event: HarnessEvent) => void | Promise<void>;
