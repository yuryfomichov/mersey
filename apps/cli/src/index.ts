import { argv, stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { createHarness } from '../../../harness/src/index.js';
import { parseProviderName, type ProviderName } from '../../../harness/src/providers/factory.js';

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

async function main(): Promise<void> {
  const provider = getProviderName(argv.slice(2));
  const cli = createInterface({ input, output });
  const harness = createHarness({ provider });

  output.write('Mersey CLI\n');
  output.write(`provider: ${provider}\n`);
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

      const reply = await harness.sendUserMessage(message);
      output.write(`assistant: ${reply.content}\n`);
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
