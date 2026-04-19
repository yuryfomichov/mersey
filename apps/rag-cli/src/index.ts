import { join } from 'node:path';
import { argv } from 'node:process';

import { createHarness } from '../../../harness/index.js';
import { createProvider } from '../../../harness/providers/index.js';
import { getBooleanFlag, getProviderName, getSessionId } from '../../helpers/cli/args.js';
import { getProviderModel } from '../../helpers/cli/harness-config.js';
import { runInteractiveCli } from '../../helpers/cli/interactive.js';
import { createCliLoggingPlugins } from '../../helpers/cli/logging.js';
import { createLocalMemoryPlugin, getLocalMemoryDefinition } from '../../helpers/cli/memory.js';
import { getProviderDefinition } from '../../helpers/cli/provider-config.js';
import { createMarkdownRagPlugin, getMarkdownRagDefinition } from '../../helpers/cli/rag.js';
import { createSession, formatSessionStore, getSessionStoreDefinition } from '../../helpers/cli/session-store.js';
import { getRagCliSystemPrompt } from './system-prompt.js';

async function main(): Promise<void> {
  const args = argv.slice(2);
  const debug = getBooleanFlag(args, '--debug');
  const stream = getBooleanFlag(args, '--stream');
  const cache = getBooleanFlag(args, '--cache');
  const providerName = getProviderName(args, 'openai');
  const providerDefinition = getProviderDefinition(providerName, process.env, cache);
  const providerInstance = createProvider(providerDefinition);
  const sessionId = getSessionId(args) ?? 'rag-session';
  const sessionStoreDefinition = getSessionStoreDefinition(args);
  const session = createSession(sessionStoreDefinition, sessionId);
  const { logPaths, plugins: loggingPlugins } = await createCliLoggingPlugins(sessionId);
  const memoryDefinition = getLocalMemoryDefinition(args);
  const memoryResult = await createLocalMemoryPlugin(memoryDefinition);
  const ragDefinition = getMarkdownRagDefinition(args, {
    defaultEnabled: true,
    defaultIndexDir: join('tmp', 'rag', 'rag-cli-data'),
  });
  const ragResult = await createMarkdownRagPlugin(ragDefinition);
  const retrievalEnabled = Boolean(ragResult.plugin);
  const harness = createHarness({
    debug,
    // prepareProviderRequest prepends compose in reverse registration order,
    // so keep memory before retrieval here to leave recalled memory closest to the live user message.
    plugins: [
      ...loggingPlugins,
      ...(memoryResult.plugin ? [memoryResult.plugin] : []),
      ...(ragResult.plugin ? [ragResult.plugin] : []),
    ],
    providerInstance,
    session,
    systemPrompt: getRagCliSystemPrompt({ retrievalEnabled }),
    tools: [],
  });
  const providerModel = getProviderModel(providerDefinition);

  await runInteractiveCli({
    appName: 'RAG CLI',
    cache,
    debug,
    extraStatusLines: [...memoryResult.summaryLines, ...ragResult.summaryLines],
    harness,
    instructionLine: "Ask a question or type 'exit' to quit.",
    logLine: `logs: ${logPaths.jsonlPath}, ${logPaths.textPath}`,
    providerModel,
    providerName,
    sessionStoreLine: formatSessionStore(sessionStoreDefinition),
    stream,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
