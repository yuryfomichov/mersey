import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createHarness } from '../../../harness/index.js';
import { getBooleanFlag, getProviderName, getSessionId } from '../../helpers/cli/args.js';
import { createDefaultTools, getProviderModel, getToolExecutionPolicy } from '../../helpers/cli/harness-config.js';
import { createCliLoggers } from '../../helpers/cli/logging.js';
import { getProviderDefinition } from '../../helpers/cli/provider-config.js';
import { createSession, formatSessionStore, getSessionStoreDefinition } from '../../helpers/cli/session-store.js';

async function main(): Promise<void> {
  const args = argv.slice(2);
  const debug = getBooleanFlag(args, '--debug');
  const stream = getBooleanFlag(args, '--stream');
  const cache = getBooleanFlag(args, '--cache');
  const providerName = getProviderName(args);
  const providerDefinition = getProviderDefinition(providerName, process.env, cache);
  const sessionId = getSessionId(args) ?? 'local-session';
  const sessionStoreDefinition = getSessionStoreDefinition(args);
  const session = createSession(sessionStoreDefinition, sessionId);
  const cli = createInterface({ input, output });
  const { logPaths, loggers } = await createCliLoggers(sessionId);
  const harness = createHarness({
    debug,
    loggers,
    provider: providerDefinition,
    session,
    systemPrompt: 'You are a helpful assistant.',
    toolExecutionPolicy: getToolExecutionPolicy(),
    tools: createDefaultTools(),
  });
  const providerModel = getProviderModel(providerDefinition);

  output.write('Mersey CLI\n');
  output.write(`provider: ${providerName}\n`);
  if (providerModel) {
    output.write(`model: ${providerModel}\n`);
  }
  output.write(`session: ${harness.session.id}\n`);
  output.write(`${formatSessionStore(sessionStoreDefinition)}\n`);
  output.write(`debug: ${String(debug)}\n`);
  output.write(`stream: ${String(stream)}\n`);
  output.write(`cache: ${String(cache)}\n`);
  output.write(`logs: ${logPaths.jsonlPath}, ${logPaths.textPath}\n\n`);

  const sessionInfo = async () => {
    const u = await harness.session.getUsage();
    const contextSize = await harness.session.getContextSize();
    const totalInputTokens = u.uncachedInputTokens + u.cachedInputTokens + u.cacheWriteInputTokens;

    output.write(
      `[usage: ${totalInputTokens} in = ${u.uncachedInputTokens} uncached + ${u.cachedInputTokens} cached + ${u.cacheWriteInputTokens} cache-write / ${u.outputTokens} out] [context size: ${contextSize} tokens]\n`,
    );
  };

  await harness.session.ensure();
  await sessionInfo();
  output.write("Type a message or 'exit' to quit.\n\n");

  try {
    while (true) {
      let value: string;

      try {
        value = await cli.question('> ');
      } catch (error: unknown) {
        if (error instanceof Error && error.message === 'readline was closed') {
          break;
        }

        throw error;
      }

      const message = value.trim();

      if (!message) {
        continue;
      }

      if (message === 'exit') {
        break;
      }

      let streamedAssistant = false;

      if (stream) {
        for await (const chunk of harness.streamMessage(message)) {
          if (chunk.type === 'assistant_delta') {
            if (!streamedAssistant) {
              output.write('assistant: ');
              streamedAssistant = true;
            }

            output.write(chunk.delta);
            continue;
          }

          if (chunk.type === 'assistant_message_completed') {
            if (streamedAssistant) {
              output.write('\n');
              streamedAssistant = false;
            }

            continue;
          }

          if (chunk.type === 'final_message') {
            if (streamedAssistant) {
              output.write('\n');
              streamedAssistant = false;
            } else {
              output.write(`assistant: ${chunk.message.content}\n`);
            }
          }
        }

        await sessionInfo();
        continue;
      }

      const reply = await harness.sendMessage(message);
      output.write(`assistant: ${reply.content}\n`);
      await sessionInfo();
    }
  } finally {
    cli.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
