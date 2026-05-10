import { argv } from 'node:process';

import { createHarnessRuntime } from '../../../harness/index.js';
import { createProvider } from '../../../harness/providers/index.js';
import { getBooleanFlag, getProviderName, getSessionId } from '../../helpers/cli/args.js';
import { createDefaultTools, getProviderModel, getToolExecutionPolicy } from '../../helpers/cli/harness-config.js';
import { runInteractiveCli } from '../../helpers/cli/interactive.js';
import { createCliLoggingPlugins } from '../../helpers/cli/logging.js';
import { getProviderDefinition } from '../../helpers/cli/provider-config.js';
import { createSession, formatSessionStore, getSessionStoreDefinition } from '../../helpers/cli/session-store.js';
import { getStartupStatusLines } from '../../helpers/cli/startup.js';

async function main(): Promise<void> {
  const args = argv.slice(2);
  const debug = getBooleanFlag(args, '--debug');
  const stream = getBooleanFlag(args, '--stream');
  const cache = getBooleanFlag(args, '--cache');
  const providerName = getProviderName(args);
  const providerDefinition = getProviderDefinition(providerName, process.env, cache);
  const providerInstance = createProvider(providerDefinition);
  const sessionId = getSessionId(args) ?? 'local-session';
  const sessionStoreDefinition = getSessionStoreDefinition(args);
  const session = createSession(sessionStoreDefinition, sessionId);
  const { logPaths, plugins: loggingPlugins } = await createCliLoggingPlugins(sessionId);
  const toolExecutionPolicy = getToolExecutionPolicy();
  const runtimeResult = await createHarnessRuntime({
    debug,
    plugins: loggingPlugins,
    providerInstance,
    session,
    systemPrompt: 'You are a helpful assistant.',
    tools: createDefaultTools({ toolExecutionPolicy }),
  });
  if (!runtimeResult.ok) {
    throw new Error(runtimeResult.startup.diagnostics.map((diagnostic) => diagnostic.message).join('\n'));
  }

  const harness = runtimeResult.runtime.harness;
  const providerModel = getProviderModel(providerDefinition);
  const startupStatusLines = getStartupStatusLines(runtimeResult.runtime.startup);

  try {
    await runInteractiveCli({
      appName: 'Mersey CLI',
      cache,
      debug,
      extraStatusLines: startupStatusLines,
      harness,
      logLine: `logs: ${logPaths.jsonlPath}, ${logPaths.textPath}`,
      providerModel,
      providerName,
      sessionStoreLine: formatSessionStore(sessionStoreDefinition),
      stream,
    });
  } finally {
    await runtimeResult.runtime.dispose();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
