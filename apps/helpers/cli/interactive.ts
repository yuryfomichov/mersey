import { stdin as defaultInput, stdout as defaultOutput } from 'node:process';
import { createInterface } from 'node:readline/promises';

import type { Harness } from '../../../harness/types.js';

type InteractiveCliOptions = {
  appName: string;
  cache: boolean;
  debug: boolean;
  extraStatusLines?: string[];
  harness: Harness;
  instructionLine?: string;
  logLine?: string;
  providerModel?: string | null;
  providerName: string;
  sessionStoreLine: string;
  stream: boolean;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
};

export async function runInteractiveCli(options: InteractiveCliOptions): Promise<void> {
  const input = options.input ?? defaultInput;
  const output = options.output ?? defaultOutput;
  const cli = createInterface({ input, output });

  const printSessionInfo = async () => {
    const usage = await options.harness.session.getUsage();
    const contextSize = await options.harness.session.getContextSize();
    const totalInputTokens = usage.uncachedInputTokens + usage.cachedInputTokens + usage.cacheWriteInputTokens;

    output.write(
      `[usage: ${totalInputTokens} in = ${usage.uncachedInputTokens} uncached + ${usage.cachedInputTokens} cached + ${usage.cacheWriteInputTokens} cache-write / ${usage.outputTokens} out] [context size: ${contextSize} tokens]\n`,
    );
  };

  output.write(`${options.appName}\n`);
  output.write(`provider: ${options.providerName}\n`);
  if (options.providerModel) {
    output.write(`model: ${options.providerModel}\n`);
  }
  output.write(`session: ${options.harness.session.id}\n`);
  output.write(`${options.sessionStoreLine}\n`);
  output.write(`debug: ${String(options.debug)}\n`);
  output.write(`stream: ${String(options.stream)}\n`);
  output.write(`cache: ${String(options.cache)}\n`);
  if (options.logLine) {
    output.write(`${options.logLine}\n`);
  }
  for (const line of options.extraStatusLines ?? []) {
    output.write(`${line}\n`);
  }
  output.write('\n');

  await options.harness.session.ensure();
  await printSessionInfo();
  output.write(`${options.instructionLine ?? "Type a message or 'exit' to quit."}\n\n`);

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

      if (options.stream) {
        for await (const chunk of options.harness.streamMessage(message)) {
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

        await printSessionInfo();
        continue;
      }

      const reply = await options.harness.sendMessage(message);
      output.write(`assistant: ${reply.content}\n`);
      await printSessionInfo();
    }
  } finally {
    cli.close();
  }
}
