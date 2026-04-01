import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  createHarness,
  type Harness,
  type PendingApproval,
  type TurnChunk,
  type TurnResult,
} from '../../../harness/index.js';
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

function getApprovalLines(approval: PendingApproval): string[] {
  const lines = [`approval required: ${approval.toolName}`];

  if (typeof approval.input.command === 'string') {
    const args = Array.isArray(approval.input.args)
      ? approval.input.args.filter((arg): arg is string => typeof arg === 'string')
      : [];

    lines.push(`command: ${[approval.input.command, ...args].join(' ')}`);
  }

  if (typeof approval.input.cwd === 'string') {
    lines.push(`cwd: ${approval.input.cwd}`);
  }

  if (typeof approval.input.path === 'string') {
    lines.push(`path: ${approval.input.path}`);
  }

  return lines;
}

async function resolveTurnResult(
  cli: ReturnType<typeof createInterface>,
  harness: Harness,
  result: TurnResult,
): Promise<string> {
  let currentResult = result;

  while (currentResult.status === 'awaiting_approval') {
    for (const line of getApprovalLines(currentResult.approval)) {
      output.write(`${line}\n`);
    }

    const answer = (await cli.question('Approve? [y/N] ')).trim().toLowerCase();

    currentResult =
      answer === 'y' || answer === 'yes' ? await harness.approvePendingTool() : await harness.denyPendingTool();
  }

  return currentResult.message.content;
}

async function renderStreamedTurn(
  cli: ReturnType<typeof createInterface>,
  harness: Harness,
  turn: AsyncIterable<TurnChunk>,
): Promise<void> {
  let streamedAssistant = false;

  for await (const chunk of turn) {
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

    if (chunk.type === 'awaiting_approval') {
      if (streamedAssistant) {
        output.write('\n');
        streamedAssistant = false;
      }

      output.write(
        `assistant: ${await resolveTurnResult(cli, harness, { approval: chunk.approval, status: 'awaiting_approval' })}\n`,
      );
      continue;
    }

    if (streamedAssistant) {
      output.write('\n');
      streamedAssistant = false;
    } else {
      output.write(`assistant: ${chunk.message.content}\n`);
    }
  }
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
    tools: [
      new ReadFileTool(),
      new WriteFileTool(),
      new EditFileTool(),
      new RunCommandTool({ trustedCommands: ['pwd'] }),
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
  output.write(`logs: ${logPaths.jsonlPath}, ${logPaths.textPath}\n`);
  output.write("Type a message or 'exit' to quit.\n\n");

  try {
    const resumedTurn = await harness.resumePendingTurn();

    if (resumedTurn) {
      output.write(`assistant: ${await resolveTurnResult(cli, harness, resumedTurn)}\n`);
    }

    const pendingApproval = await harness.getPendingApproval();

    if (pendingApproval) {
      output.write(
        `assistant: ${await resolveTurnResult(cli, harness, { approval: pendingApproval, status: 'awaiting_approval' })}\n`,
      );
    }

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

      if (stream) {
        await renderStreamedTurn(cli, harness, harness.streamUserMessage(message));
        continue;
      }

      const reply = await harness.sendUserMessage(message);
      output.write(`assistant: ${await resolveTurnResult(cli, harness, reply)}\n`);
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
