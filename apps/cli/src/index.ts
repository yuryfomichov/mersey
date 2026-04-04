import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  createHarness,
  EditFileTool,
  parseProviderName,
  ReadFileTool,
  RunCommandTool,
  type ProviderName,
  WriteFileTool,
} from '../../../harness/index.js';
import { createCliLoggers } from './logging.js';
import { getProviderDefinition } from './provider-config.js';
import { createSession, formatSessionStore, getSessionStoreDefinition } from './session-store.js';

function getProviderName(args: string[]): ProviderName {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--provider') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('Missing value for --provider.');
      }

      return parseProviderName(value);
    }

    if (arg.startsWith('--provider=')) {
      return parseProviderName(arg.slice('--provider='.length));
    }
  }

  return 'minimax';
}

function getSessionId(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--session-id') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('Missing value for --session-id.');
      }

      return value;
    }

    if (arg.startsWith('--session-id=')) {
      return arg.slice('--session-id='.length);
    }
  }

  return undefined;
}

function getDebugMode(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--debug' || arg === '--debug=true') {
      return true;
    }

    if (arg === '--debug=false') {
      return false;
    }
  }

  return false;
}

function getStreamMode(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--stream' || arg === '--stream=true') {
      return true;
    }

    if (arg === '--stream=false') {
      return false;
    }
  }

  return false;
}

function getCacheMode(args: string[]): boolean {
  for (const arg of args) {
    if (arg === '--cache' || arg === '--cache=true') {
      return true;
    }

    if (arg === '--cache=false') {
      return false;
    }
  }

  return false;
}

function getProviderModel(provider: ReturnType<typeof getProviderDefinition>): string | null {
  return 'config' in provider && provider.config?.model ? provider.config.model : null;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const debug = getDebugMode(args);
  const stream = getStreamMode(args);
  const cache = getCacheMode(args);
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
    toolExecutionPolicy: {
      maxToolResultBytes: 16 * 1024,
      workspaceRoot: process.cwd(),
    },
    tools: [
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool(),
      new RunCommandTool({
        commandAllowlist: ['git', 'ls', 'pwd'],
        defaultTimeoutMs: 5_000,
        maxOutputBytes: 16 * 1024,
        maxTimeoutMs: 15_000,
      }),
    ],
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
    output.write(
      `[usage: ${u.inputTokens}in / ${u.outputTokens}out / ${u.cachedTokens}cached] [context: ${contextSize}]\n`,
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
