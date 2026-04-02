import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import {
  createHarness,
  EditFileTool,
  parseProviderName,
  ReadFileTool,
  RunCommandTool,
  type ApprovalDecision,
  type ApprovalHandler,
  type PendingApproval,
  type ProviderName,
  type TurnChunk,
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

function getProviderModel(provider: ReturnType<typeof getProviderDefinition>): string | null {
  return 'config' in provider && provider.config?.model ? provider.config.model : null;
}

async function promptForApproval(
  cli: ReturnType<typeof createInterface>,
  pendingApproval: PendingApproval,
): Promise<ApprovalDecision[]> {
  const decisions: ApprovalDecision[] = [];

  output.write('approval required:\n');

  for (const toolCall of pendingApproval.assistantMessage.toolCalls ?? []) {
    if (!pendingApproval.requiredToolCallIds.includes(toolCall.id)) {
      continue;
    }

    const answer = await cli.question(`approve ${toolCall.name} ${JSON.stringify(toolCall.input)}? [y/N] `);

    decisions.push({
      toolCallId: toolCall.id,
      type: answer.trim().toLowerCase() === 'y' ? 'approve' : 'deny',
    });
  }

  return decisions;
}

async function renderTurn(chunks: AsyncIterable<TurnChunk>): Promise<void> {
  let streamedAssistant = false;

  for await (const chunk of chunks) {
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
      } else {
        output.write(`assistant: ${chunk.message.content}\n`);
      }

      streamedAssistant = false;
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
  const session = createSession(sessionStoreDefinition, sessionId);
  const cli = createInterface({ input, output });
  const { logPaths, loggers } = await createCliLoggers(sessionId);
  const approvalHandler: ApprovalHandler = (pendingApproval) => promptForApproval(cli, pendingApproval);
  const harness = createHarness({
    approvalHandler,
    debug,
    loggers,
    provider: providerDefinition,
    session,
    stream,
    toolExecutionPolicy: {
      maxToolResultBytes: 16 * 1024,
      workspaceRoot: process.cwd(),
    },
    tools: [
      { policy: { action: 'require_approval', type: 'fixed' }, tool: new ReadFileTool() },
      { policy: { action: 'require_approval', type: 'fixed' }, tool: new WriteFileTool() },
      { policy: { action: 'require_approval', type: 'fixed' }, tool: new EditFileTool() },
      {
        policy: { action: 'require_approval', type: 'fixed' },
        tool: new RunCommandTool({
          commandAllowlist: ['git', 'ls', 'pwd'],
          defaultTimeoutMs: 5_000,
          maxOutputBytes: 16 * 1024,
          maxTimeoutMs: 15_000,
        }),
      },
    ],
  });
  await harness.ready();
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
    await renderTurn(harness.resumePendingApprovalIfNeeded());

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

      await renderTurn(harness.streamUserMessage(message));
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
