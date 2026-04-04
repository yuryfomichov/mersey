import type { ProviderDefinition, ProviderName } from '../../../harness/index.js';

const ANTHROPIC_PROVIDER_CONFIG = {
  baseUrl: 'https://api.anthropic.com',
  maxTokens: 2048,
  model: 'claude-sonnet-4-20250514',
} as const;

const MINIMAX_PROVIDER_CONFIG = {
  baseUrl: 'https://api.minimax.io/anthropic',
  maxTokens: 2048,
  model: 'MiniMax-M2.7',
} as const;

const OPENAI_PROVIDER_CONFIG = {
  baseUrl: 'https://api.openai.com/v1',
  maxTokens: 2048,
  model: 'gpt-5.4-mini',
} as const;

function getRequiredEnv(env: NodeJS.ProcessEnv, name: string, owner: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing ${name}. Add it to the environment before starting the ${owner} provider.`);
  }

  return value;
}

export function getProviderDefinition(
  name: ProviderName,
  env: NodeJS.ProcessEnv = process.env,
  cache?: boolean,
): ProviderDefinition {
  switch (name) {
    case 'anthropic':
      return {
        name: 'anthropic',
        config: {
          apiKey: getRequiredEnv(env, 'ANTHROPIC_API_KEY', 'anthropic'),
          ...ANTHROPIC_PROVIDER_CONFIG,
          ...(cache && { cache }),
        },
      };
    case 'fake':
      return {
        name: 'fake',
      };
    case 'minimax':
      return {
        name: 'minimax',
        config: {
          apiKey: getRequiredEnv(env, 'MINIMAX_API_KEY', 'minimax'),
          ...MINIMAX_PROVIDER_CONFIG,
          ...(cache && { cache }),
        },
      };
    case 'openai':
      return {
        name: 'openai',
        config: {
          apiKey: getRequiredEnv(env, 'OPENAI_API_KEY', 'openai'),
          ...OPENAI_PROVIDER_CONFIG,
          ...(cache && { cache }),
        },
      };
    default:
      throw new Error(`Unsupported provider: ${name}`);
  }
}
