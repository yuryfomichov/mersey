import type { NormalizedTurnContext } from '../context/types.js';
import type { ModelMessage, ModelToolDefinition, ModelUsage } from '../models/types.js';

export type HarnessEventBase = {
  sessionId: string;
  timestamp: string;
  type:
    | 'session_started'
    | 'iteration_started'
    | 'turn_started'
    | 'turn_snapshot_started'
    | 'turn_snapshot_degraded'
    | 'turn_snapshot_failed'
    | 'turn_snapshot_completed'
    | 'provider_requested'
    | 'provider_responded'
    | 'provider_blocked'
    | 'tool_requested'
    | 'tool_started'
    | 'tool_finished'
    | 'tool_blocked'
    | 'hook_error'
    | 'turn_finished'
    | 'turn_failed';
};

export type HarnessTurnEventBase = HarnessEventBase & {
  turnId: string;
};

export type SessionStartedEvent = HarnessEventBase & {
  debug: boolean;
  providerName: string;
  runId: string;
  type: 'session_started';
};

export type IterationStartedEvent = HarnessTurnEventBase & {
  iteration: number;
  messageCount: number;
  type: 'iteration_started';
};

export type TurnStartedEvent = HarnessTurnEventBase & {
  type: 'turn_started';
  userMessageLength: number;
};

export type TurnSnapshotStartedEvent = HarnessTurnEventBase & {
  iteration: number;
  type: 'turn_snapshot_started';
};

export type TurnSnapshotDegradedEvent = HarnessTurnEventBase & {
  affectedSourceIds: string[];
  iteration: number;
  reason: string;
  type: 'turn_snapshot_degraded';
};

export type TurnSnapshotFailedEvent = HarnessTurnEventBase & {
  affectedSourceIds: string[];
  iteration: number;
  reason: string;
  type: 'turn_snapshot_failed';
};

export type TurnSnapshotCompletedEvent = HarnessTurnEventBase & {
  contextMessageCount: number;
  contextMetadataKeys: string[];
  contextResourceCount: number;
  iteration: number;
  toolDefinitionCount: number;
  type: 'turn_snapshot_completed';
};

export type DebugProviderRequest = {
  context?: NormalizedTurnContext;
  messages: ModelMessage[];
  stream: boolean;
  systemPrompt?: string;
  tools?: ModelToolDefinition[];
};

export type ProviderRequestedEvent = HarnessTurnEventBase & {
  debugRequest?: DebugProviderRequest;
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
  type: 'provider_requested';
};

export type ProviderRespondedEvent = HarnessTurnEventBase & {
  durationMs: number;
  iteration: number;
  model: string;
  providerName: string;
  textLength: number;
  toolCallCount: number;
  toolCallNames: string[];
  type: 'provider_responded';
  usedFallbackText: boolean;
  usage: ModelUsage;
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

export type ToolRequestedEvent = HarnessTurnEventBase & {
  debugArgs?: DebugToolArgs;
  iteration: number;
  originalName: string;
  publicName: string;
  safeArgs: SafeToolArgs;
  sourceId: string;
  toolCallId: string;
  toolId: string;
  type: 'tool_requested';
};

export type ToolStartedEvent = HarnessTurnEventBase & {
  iteration: number;
  publicName: string;
  sourceId: string;
  toolCallId: string;
  toolId: string;
  type: 'tool_started';
};

export type ToolFinishedEvent = HarnessTurnEventBase & {
  durationMs: number;
  isError: boolean;
  iteration: number;
  publicName: string;
  resultContentLength: number;
  resultMetadataKeys: string[];
  sourceId: string;
  toolCallId: string;
  toolId: string;
  type: 'tool_finished';
};

export type ToolBlockedEvent = HarnessTurnEventBase & {
  exposeToModel: boolean;
  iteration: number;
  publicName: string;
  reason: string;
  sourceId: string;
  toolCallId: string;
  toolId: string;
  type: 'tool_blocked';
};

export type ProviderBlockedEvent = HarnessTurnEventBase & {
  exposeToModel: boolean;
  iteration: number;
  reason: string;
  type: 'provider_blocked';
};

export type HookErrorEvent = HarnessTurnEventBase & {
  errorMessage: string;
  hookName: 'beforeProviderCall' | 'beforeToolExecution' | 'afterTurnCommitted' | 'onEvent';
  pluginName: string;
  type: 'hook_error';
};

export type TurnFinishedEvent = HarnessTurnEventBase & {
  durationMs: number;
  finalAssistantLength: number;
  totalIterations: number;
  totalToolCalls: number;
  type: 'turn_finished';
};

export type TurnFailedEvent = HarnessTurnEventBase & {
  durationMs: number;
  errorMessage: string;
  errorType: 'provider' | 'tool' | 'runtime';
  iteration: number;
  type: 'turn_failed';
};

export type HarnessEvent =
  | SessionStartedEvent
  | IterationStartedEvent
  | TurnStartedEvent
  | TurnSnapshotStartedEvent
  | TurnSnapshotDegradedEvent
  | TurnSnapshotFailedEvent
  | TurnSnapshotCompletedEvent
  | ProviderRequestedEvent
  | ProviderRespondedEvent
  | ProviderBlockedEvent
  | ToolRequestedEvent
  | ToolStartedEvent
  | ToolFinishedEvent
  | ToolBlockedEvent
  | HookErrorEvent
  | TurnFailedEvent
  | TurnFinishedEvent;

export type HarnessEventListener = (event: HarnessEvent) => void | Promise<void>;
