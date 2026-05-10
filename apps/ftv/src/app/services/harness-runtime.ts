import { createHarnessRuntime as createRootHarnessRuntime } from '../../../../../harness/index.js';
import { createProvider } from '../../../../../harness/providers/index.js';
import { type ProviderName } from '../../../../../harness/providers/types.js';
import { type Harness, type HarnessEvent } from '../../../../../harness/types.js';
import {
  createDefaultTools,
  getProviderModel,
  getToolExecutionPolicy,
} from '../../../../helpers/cli/harness-config.js';
import { createCliLoggingPlugins } from '../../../../helpers/cli/logging.js';
import { getProviderDefinition } from '../../../../helpers/cli/provider-config.js';
import { createSession, type SessionStoreDefinition } from '../../../../helpers/cli/session-store.js';
import { getStartupStatusLines } from '../../../../helpers/cli/startup.js';
import { createAwaitableToolApprovalPlugin, type BlockAndAskUser } from '../../tool-approval-plugin.js';
import { FTV_COMMAND_ALLOWLIST } from '../constants.js';
import { getSystemPrompt } from '../system-prompt.js';

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
  startupLines: string[];
  dispose: () => Promise<void>;
}

export async function createHarnessRuntime(
  options: HarnessRuntimeOptions,
  onEvent: (event: HarnessEvent) => void,
): Promise<HarnessRuntime> {
  const { cache, debug, providerName, sessionId, sessionStoreDefinition, blockAndAskUser } = options;

  const session = createSession(sessionStoreDefinition, sessionId);
  const providerDef = getProviderDefinition(providerName, process.env, cache);
  const providerInstance = createProvider(providerDef);
  const toolExecutionPolicy = getToolExecutionPolicy();
  const toolApprovalPlugin = createAwaitableToolApprovalPlugin({ blockAndAskUser });

  const { plugins: loggingPlugins } = await createCliLoggingPlugins(sessionId);

  const runtimeResult = await createRootHarnessRuntime({
    debug,
    plugins: [...loggingPlugins, toolApprovalPlugin],
    providerInstance,
    session,
    systemPrompt: getSystemPrompt(),
    tools: createDefaultTools({ commandAllowlist: FTV_COMMAND_ALLOWLIST, toolExecutionPolicy }),
  });
  if (!runtimeResult.ok) {
    throw new Error(runtimeResult.startup.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  const harness = runtimeResult.runtime.harness;

  const unsubscribe = harness.subscribe(onEvent);
  const providerModel = getProviderModel(providerDef);

  return {
    harness,
    providerModel,
    startupLines: getStartupStatusLines(runtimeResult.runtime.startup),
    dispose: async () => {
      unsubscribe();
      await runtimeResult.runtime.dispose();
    },
  };
}
