import { createHarness, type Harness, type HarnessEvent, type ProviderName } from '../../../../../harness/index.js';
import {
  createDefaultTools,
  getProviderModel,
  getToolExecutionPolicy,
} from '../../../../helpers/cli/harness-config.js';
import { createCliLoggingPlugins } from '../../../../helpers/cli/logging.js';
import { getProviderDefinition } from '../../../../helpers/cli/provider-config.js';
import { createSession, type SessionStoreDefinition } from '../../../../helpers/cli/session-store.js';
import { createAwaitableToolApprovalPlugin, type BlockAndAskUser } from '../../tool-approval-plugin.js';
import { FTV_COMMAND_ALLOWLIST } from '../constants.js';

export interface HarnessRuntimeOptions {
  cache: boolean;
  debug: boolean;
  providerName: ProviderName;
  sessionId: string;
  sessionStoreDefinition: SessionStoreDefinition;
  blockAndAskUser: BlockAndAskUser;
}

export interface HarnessRuntime {
  harness: Harness;
  providerModel: string | null;
  dispose: () => void;
}

export async function createHarnessRuntime(
  options: HarnessRuntimeOptions,
  onEvent: (event: HarnessEvent) => void,
): Promise<HarnessRuntime> {
  const { cache, debug, providerName, sessionId, sessionStoreDefinition, blockAndAskUser } = options;

  const session = createSession(sessionStoreDefinition, sessionId);
  const providerDef = getProviderDefinition(providerName, process.env, cache);
  const toolExecutionPolicy = getToolExecutionPolicy();
  const toolApprovalPlugin = createAwaitableToolApprovalPlugin({ blockAndAskUser });

  const { plugins: loggingPlugins } = await createCliLoggingPlugins(sessionId);

  const harness = createHarness({
    debug,
    plugins: [...loggingPlugins, toolApprovalPlugin],
    provider: providerDef,
    session,
    tools: createDefaultTools({ commandAllowlist: FTV_COMMAND_ALLOWLIST, toolExecutionPolicy }),
  });

  const unsubscribe = harness.subscribe(onEvent);
  const providerModel = getProviderModel(providerDef);

  return {
    harness,
    providerModel,
    dispose: () => {
      unsubscribe();
    },
  };
}