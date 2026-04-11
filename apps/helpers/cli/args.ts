import { parseProviderName } from '../../../harness/providers/index.js';
import { type ProviderName } from '../../../harness/providers/types.js';

export function getArgValue(args: string[], name: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === name) {
      const value = args[index + 1];

      if (!value) {
        throw new Error(`Missing value for ${name}.`);
      }

      return value;
    }

    if (arg.startsWith(`${name}=`)) {
      return arg.slice(`${name}=`.length);
    }
  }

  return null;
}

export function getBooleanFlag(args: string[], name: string, defaultValue = false): boolean {
  for (const arg of args) {
    if (arg === name || arg === `${name}=true`) {
      return true;
    }

    if (arg === `${name}=false`) {
      return false;
    }
  }

  return defaultValue;
}

export function getProviderName(args: string[], defaultProvider: ProviderName = 'minimax'): ProviderName {
  const value = getArgValue(args, '--provider');
  return value ? parseProviderName(value) : defaultProvider;
}

export function getSessionId(args: string[]): string | undefined {
  return getArgValue(args, '--session-id') ?? undefined;
}
