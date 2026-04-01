import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createHarness } from '../../../harness/index.js';
import { parseProviderName, type ProviderName } from '../../../harness/providers.js';
import { EditFileTool, ReadFileTool, RunCommandTool, WriteFileTool } from '../../../harness/tools.js';
import { createCliLoggers } from './logging.js';
import { getProviderDefinition } from './provider-config.js';
import { createSessionStore, formatSessionStore, getSessionStoreDefinition } from './session-store.js';

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

function getProviderModel(provider: ReturnType<typeof getProviderDefinition>): string | null {
  return 'config' in provider && provider.config?.model ? provider.config.model : null;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const debug = getDebugMode(args);
  const stream = getStreamMode(args);
  const providerName = getProviderName(args);
  const providerDefinition = getProviderDefinition(providerName);
  const sessionId = getSessionId(args) ?? 'local-session';
  const sessionStoreDefinition = getSessionStoreDefinition(args);
  const cli = createInterface({ input, output });
  const { logPaths, loggers } = await createCliLoggers(sessionId);
  const harness = createHarness({
    debug,
    loggers,
    provider: providerDefinition,
    sessionId,
    sessionStore: createSessionStore(sessionStoreDefinition),
    stream,
    toolPolicy: {
      commandAllowlist: ['git', 'ls', 'pwd'],
      defaultCommandTimeoutMs: 5_000,
      maxCommandOutputBytes: 16 * 1024,
      maxCommandTimeoutMs: 15_000,
      maxToolResultBytes: 16 * 1024,
      workspaceRoot: process.cwd(),
    },
    tools: [new ReadFileTool(), new WriteFileTool(), new EditFileTool(), new RunCommandTool()],
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
  output.write(`logs: ${logPaths.jsonlPath}, ${logPaths.textPath}\n`);
  output.write("Type a message or 'exit' to quit.\n\n");

  let streamingAssistantOpen = false;

  harness.subscribe((event) => {
    if (!stream) {
      return;
    }

    if (event.type === 'provider_text_delta') {
      if (event.delta.length === 0) {
        return;
      }

      if (!streamingAssistantOpen) {
        output.write('assistant: ');
        streamingAssistantOpen = true;
      }

      output.write(event.delta);
      return;
    }

    if (event.type === 'provider_responded' || event.type === 'turn_failed') {
      if (streamingAssistantOpen) {
        output.write('\n');
        streamingAssistantOpen = false;
      }
    }
  });

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

      const reply = await harness.sendUserMessage(message);

      if (!reply.finalReplyStreamed) {
        output.write(`assistant: ${reply.message.content}\n`);
      }
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
