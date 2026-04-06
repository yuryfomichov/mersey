import type { ProviderName } from '../../../../harness/types.js';
import type { SessionStoreDefinition } from '../../../helpers/cli/session-store.js';

export interface UsageState {
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  contextSize: number;
  outputTokens: number;
  uncachedInputTokens: number;
}

export interface PendingToolApproval {
  toolName: string;
  summary?: string;
}

export type ToolApprovalResult = 'approved' | 'denied' | 'timed_out';

export interface TuiAppProps {
  cache: boolean;
  debug: boolean;
  providerName: ProviderName;
  sessionId: string;
  sessionStoreDefinition: SessionStoreDefinition;
  sessionStoreLabel: string;
}

export type { ProviderName, SessionStoreDefinition };
